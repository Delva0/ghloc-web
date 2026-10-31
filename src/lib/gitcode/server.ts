import { HTTPError } from "nitro/h3";
import { buildLocs, countLines, matchesFilter } from "./locs.ts";

type TreeEntry = { path: string; sha: string; type: string; mode?: string; size?: number };
type Tree = { tree: TreeEntry[]; truncated?: boolean };
export type GitCodeRepo = {
	default_branch: string;
	description?: string;
	stargazers_count?: number;
	forks_count?: number;
	private?: boolean;
	public?: boolean;
};
const API = "https://api.gitcode.com/api/v5";
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function repoPath(owner: string, repo: string) {
	if (![owner, repo].every(part => /^[\w.-]+$/.test(part) && part !== "." && part !== "..")) {
		throw new HTTPError({ statusCode: 400, statusMessage: "Invalid repository" });
	}
	return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function request(
	path: string,
	query: Record<string, string | number> = {},
	authenticated = false,
) {
	const url = new URL(API + path);
	for (const [key, value] of Object.entries(query)) {
		url.searchParams.set(key, String(value));
	}
	const token = authenticated ? process.env.NITRO_GITCODE_TOKEN : undefined;
	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				"User-Agent": "ghloc-web",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			redirect: "error",
			signal: AbortSignal.timeout(20_000),
		});
	} catch {
		throw new HTTPError({
			statusCode: 502,
			statusMessage: "GitCode could not be reached. Please retry.",
		});
	}
	if (!response.ok) {
		const status = response.status;
		const message =
			status === 404
				? "GitCode repository, branch or file not found"
				: status === 429
					? "GitCode API rate limit reached. Please retry later."
					: status === 401 || status === 403
						? "GitCode denied access to this public resource"
						: "GitCode API request failed";
		throw new HTTPError({
			statusCode: status >= 400 && status < 500 ? status : 502,
			statusMessage: message,
		});
	}
	return response;
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
	return cached(`repo:${owner}/${repo}`, async (): Promise<GitCodeRepo> => {
		const path = repoPath(owner, repo);
		// Always prove anonymous access first: a server token must never publish private code.
		await request(`${path}/git/trees/HEAD`, { per_page: 1 });
		try {
			const data = (await (await request(path, {}, true)).json()) as GitCodeRepo;
			if (data.private || data.public === false) {
				throw new HTTPError({
					statusCode: 404,
					statusMessage: "Only public GitCode repositories are supported",
				});
			}
			return data;
		} catch (error) {
			if (
				error instanceof HTTPError &&
				(error.statusCode === 401 || error.statusCode === 403)
			) {
				return { default_branch: "HEAD" };
			}
			throw error;
		}
	});
}

async function getTree(owner: string, repo: string, branch: string) {
	const entries: TreeEntry[] = [];
	const paths = new Set<string>();
	for (let page = 1; page <= 100; page++) {
		const data = (await (
			await request(`${repoPath(owner, repo)}/git/trees/${encodeURIComponent(branch)}`, {
				recursive: 1,
				per_page: 100,
				page,
			})
		).json()) as Tree;
		if (!Array.isArray(data.tree) || data.truncated) {
			throw new HTTPError({
				statusCode: 422,
				statusMessage: "GitCode returned an incomplete file tree",
			});
		}
		for (const entry of data.tree) {
			if (paths.has(entry.path)) {
				throw new HTTPError({
					statusCode: 502,
					statusMessage: "GitCode pagination returned duplicate paths",
				});
			}
			paths.add(entry.path);
			entries.push(entry);
		}
		if (data.tree.length < 100) {
			return entries;
		}
	}
	throw new HTTPError({ statusCode: 413, statusMessage: "Repository file tree is too large" });
}

export async function getGitCodeFile(owner: string, repo: string, branch: string, path: string) {
	await getGitCodeRepo(owner, repo);
	if (
		!path ||
		path.length > 1024 ||
		path.split("/").some(part => !part || part === "." || part === "..")
	) {
		throw new HTTPError({ statusCode: 400, statusMessage: "Invalid file path" });
	}
	const response = await request(
		`${repoPath(owner, repo)}/raw/${path.split("/").map(encodeURIComponent).join("/")}`,
		{ ref: branch },
	);
	return readBytes(response);
}

async function readBytes(response: Response) {
	if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) {
		await response.body?.cancel();
		throw new HTTPError({ statusCode: 413, statusMessage: "File exceeds the 2 MiB limit" });
	}
	const reader = response.body?.getReader();
	if (!reader) {
		return new Uint8Array();
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		size += value.length;
		if (size > MAX_FILE_BYTES) {
			await reader.cancel();
			throw new HTTPError({ statusCode: 413, statusMessage: "File exceeds the 2 MiB limit" });
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

let running = 0;
export function getGitCodeLocs(owner: string, repo: string, branch = "HEAD", filter = "") {
	return cached(`locs:${JSON.stringify([owner, repo, branch, filter])}`, async () => {
		if (filter.length > 500) {
			throw new HTTPError({ statusCode: 400, statusMessage: "Filter is too long" });
		}
		if (running >= 2) {
			throw new HTTPError({
				statusCode: 429,
				statusMessage: "Two repositories are already being counted. Please retry shortly.",
			});
		}
		running++;
		try {
			await getGitCodeRepo(owner, repo);
			const files = (await getTree(owner, repo, branch)).filter(
				entry =>
					entry.type === "blob" &&
					entry.mode !== "120000" &&
					matchesFilter(entry.path, filter),
			);
			if (files.length > MAX_FILES) {
				throw new HTTPError({
					statusCode: 413,
					statusMessage:
						"More than 2000 files match. Use a path or extension filter to narrow the count.",
				});
			}
			const results: { path: string; loc: number }[] = [];
			let next = 0;
			let bytes = 0;
			let failure: unknown;
			await Promise.all(
				Array.from({ length: 4 }, async () => {
					while (next < files.length && !failure) {
						const file = files[next++];
						try {
							const content = await getGitCodeFile(owner, repo, branch, file.path);
							bytes += content.length;
							if (bytes > MAX_TOTAL_BYTES) {
								throw new HTTPError({
									statusCode: 413,
									statusMessage:
										"Matching files exceed 50 MiB. Narrow the filter.",
								});
							}
							results.push({ path: file.path, loc: countLines(content) });
						} catch (error) {
							failure = error;
						}
					}
				}),
			);
			if (failure) {
				throw failure;
			}
			return buildLocs(results);
		} finally {
			running--;
		}
	});
}
