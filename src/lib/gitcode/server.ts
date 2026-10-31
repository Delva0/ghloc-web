import { HTTPError } from "nitro/h3";
import { getGitCodePublicRepo, getGitCodeSnapshot, readGitCodeSnapshotFile } from "./snapshot.ts";

export type GitCodeRepo = {
	default_branch: string;
	description?: string;
	stargazers_count?: number;
	forks_count?: number;
};
const API = "https://api.gitcode.com/api/v5";

function repoPath(owner: string, repo: string) {
	if (![owner, repo].every(part => /^[\w.-]+$/.test(part) && part !== "." && part !== "..")) {
		throw new HTTPError({ statusCode: 400, statusMessage: "Invalid repository" });
	}
	return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

// Descriptions are optional. API failures must never block repository pages or counts.
export async function enrichGitCodeRepo(
	owner: string,
	repo: string,
	publicRepo: GitCodeRepo,
): Promise<GitCodeRepo> {
	const path = repoPath(owner, repo);
	const token = process.env.NITRO_GITCODE_TOKEN;
	if (!token) {
		return publicRepo;
	}
	try {
		const response = await fetch(API + path, {
			headers: { "User-Agent": "ghloc-web", Authorization: `Bearer ${token}` },
			redirect: "error",
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) {
			return publicRepo;
		}
		const data = (await response.json()) as Record<string, unknown>;
		if (data.private || data.public === false) {
			return publicRepo;
		}
		return {
			...publicRepo,
			...(typeof data.description === "string" ? { description: data.description } : {}),
			...(typeof data.stargazers_count === "number"
				? { stargazers_count: data.stargazers_count }
				: {}),
			...(typeof data.forks_count === "number" ? { forks_count: data.forks_count } : {}),
		};
	} catch {
		return publicRepo;
	}
}

// Short-lived cache also coalesces concurrent badge/page requests, with bounded memory.
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
function cached<T>(key: string, work: () => Promise<T>): Promise<T> {
	const previous = cache.get(key);
	if (previous && previous.expires > Date.now()) {
		return previous.value as Promise<T>;
	}
	if (cache.size >= 30) {
		cache.delete(cache.keys().next().value!);
	}
	const value = work().catch(error => {
		cache.delete(key);
		throw error;
	});
	cache.set(key, { expires: Date.now() + 5 * 60_000, value });
	return value;
}

export function getGitCodeRepo(owner: string, repo: string) {
	repoPath(owner, repo);
	return cached(`repo:${owner}/${repo}`, async () => {
		// Git uses no credentials: a server token must never publish private code.
		const publicRepo = await getGitCodePublicRepo(owner, repo);
		return enrichGitCodeRepo(owner, repo, publicRepo);
	});
}

export function getGitCodeFile(owner: string, repo: string, branch: string, path: string) {
	repoPath(owner, repo);
	return readGitCodeSnapshotFile(owner, repo, branch, path);
}

let running = 0;
export function getGitCodeLocs(owner: string, repo: string, branch = "HEAD", filter = "") {
	repoPath(owner, repo);
	if (typeof filter !== "string" || filter.length > 500) {
		throw new HTTPError({
			statusCode: 400,
			statusMessage: "Invalid filter or filter is too long",
		});
	}
	return cached(`locs:${JSON.stringify([owner, repo, branch, filter])}`, async () => {
		if (running >= 2) {
			throw new HTTPError({
				statusCode: 429,
				statusMessage: "Two repositories are already being counted. Please retry shortly.",
			});
		}
		running++;
		try {
			return await getGitCodeSnapshot(owner, repo, branch, filter);
		} finally {
			running--;
		}
	});
}
