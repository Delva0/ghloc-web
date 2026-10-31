import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { HTTPError } from "nitro/h3";
import { buildLocs, countLines, matchesFilter } from "./locs.ts";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 2000;

function git(directory: string, args: string[], input?: string, maxBuffer = 16 * 1024 * 1024) {
	return new Promise<Buffer>((resolveResult, reject) => {
		const child = execFile(
			"git",
			["-c", "credential.helper=", "-C", directory, ...args],
			{
				encoding: "buffer",
				timeout: 60_000,
				maxBuffer,
				windowsHide: true,
				env: {
					...process.env,
					GIT_TERMINAL_PROMPT: "0",
					GCM_INTERACTIVE: "Never",
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
				},
			},
			(error, stdout) => (error ? reject(error) : resolveResult(stdout)),
		);
		child.stdin?.on("error", () => {
			/* command errors are reported by execFile */
		});
		child.stdin?.end(input);
	});
}

export function validateRef(ref: string) {
	if (
		typeof ref !== "string" ||
		!ref ||
		ref.length > 200 ||
		ref.startsWith("-") ||
		/[~^:?*[\]\\]/.test(ref) ||
		Array.from(ref).some(
			character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
		) ||
		ref.includes("..") ||
		ref.includes("@{")
	) {
		throw new HTTPError({ statusCode: 400, statusMessage: "Invalid branch, tag or commit" });
	}
}

export async function countGitSnapshot(directory: string, revision: string, filter = "") {
	const tree = await git(directory, ["ls-tree", "-r", "-l", "-z", "--full-tree", revision]);
	const files = tree
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.flatMap(entry => {
			const match = entry.match(/^(\d+) (\w+) ([a-f0-9]+)\s+(\d+|-)\t([\s\S]+)$/);
			if (!match) {
				throw new HTTPError({ statusCode: 502, statusMessage: "Invalid Git file tree" });
			}
			const [, mode, type, sha, size, path] = match;
			return type === "blob" && mode !== "120000" && matchesFilter(path, filter)
				? [{ path, sha, size: Number(size) }]
				: [];
		});
	if (files.length > MAX_FILES) {
		throw new HTTPError({
			statusCode: 413,
			statusMessage:
				"More than 2000 files match. Use a path or extension filter to narrow the count.",
		});
	}
	if (files.some(file => file.size > MAX_FILE_BYTES)) {
		throw new HTTPError({
			statusCode: 413,
			statusMessage: "File exceeds the 2 MiB limit. Narrow the filter.",
		});
	}
	if (files.reduce((size, file) => size + file.size, 0) > MAX_TOTAL_BYTES) {
		throw new HTTPError({
			statusCode: 413,
			statusMessage: "Matching files exceed 50 MiB. Narrow the filter.",
		});
	}
	const unique = [...new Map(files.map(file => [file.sha, file])).values()];
	if (!unique.length) {
		return buildLocs([]);
	}
	const blobs = await git(
		directory,
		["cat-file", "--batch"],
		unique.map(file => file.sha).join("\n") + "\n",
		MAX_TOTAL_BYTES + MAX_FILES * 128,
	);
	let offset = 0;
	const counts = new Map<string, number>();
	for (const file of unique) {
		const newline = blobs.indexOf(10, offset);
		const header = blobs.subarray(offset, newline).toString("ascii");
		if (
			newline < 0 ||
			header !== `${file.sha} blob ${file.size}` ||
			newline + 1 + file.size >= blobs.length
		) {
			throw new HTTPError({ statusCode: 502, statusMessage: "Incomplete Git file content" });
		}
		offset = newline + 1;
		counts.set(file.sha, countLines(blobs.subarray(offset, offset + file.size)));
		offset += file.size + 1;
	}
	return buildLocs(files.map(file => ({ path: file.path, loc: counts.get(file.sha)! })));
}

function repositoryUrl(owner: string, repo: string) {
	if (![owner, repo].every(part => /^[\w.-]+$/.test(part) && part !== "." && part !== "..")) {
		throw new HTTPError({ statusCode: 400, statusMessage: "Invalid repository" });
	}
	return `https://gitcode.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
}

function remoteError(error: unknown) {
	const message = error instanceof Error ? error.message : "";
	return new HTTPError({
		statusCode:
			/couldn't find remote ref|not found|could not read Username|authentication failed/i.test(
				message,
			)
				? 404
				: 502,
		statusMessage: "Unable to read the public GitCode repository or selected branch",
	});
}

export async function getGitCodePublicRepo(owner: string, repo: string) {
	const url = repositoryUrl(owner, repo);
	let output: Buffer;
	try {
		output = await git(tmpdir(), ["ls-remote", "--symref", url, "HEAD"]);
	} catch (error) {
		throw remoteError(error);
	}
	const text = output.toString("utf8");
	if (!/^[a-f0-9]+\tHEAD$/m.test(text)) {
		throw new HTTPError({
			statusCode: 404,
			statusMessage: "Public repository has no HEAD commit",
		});
	}
	return { default_branch: text.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1] ?? "HEAD" };
}

async function withGitCodeSnapshot<T>(
	owner: string,
	repo: string,
	ref: string,
	work: (directory: string) => Promise<T>,
) {
	validateRef(ref);
	const url = repositoryUrl(owner, repo);
	const directory = await mkdtemp(join(tmpdir(), "ghloc-gitcode-"));
	try {
		await git(directory, ["init", "--bare", "."]);
		try {
			await git(directory, [
				"-c",
				"pack.threads=1",
				"fetch",
				"--depth=1",
				"--no-tags",
				"--",
				url,
				ref,
			]);
		} catch (error) {
			throw remoteError(error);
		}
		return await work(directory);
	} finally {
		// Only remove the fresh temporary bare repository; no source files are checked out.
		if (
			resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
			directory.startsWith(join(tmpdir(), "ghloc-gitcode-"))
		) {
			await rm(directory, { recursive: true, force: true });
		}
	}
}

export function getGitCodeSnapshot(owner: string, repo: string, ref: string, filter: string) {
	return withGitCodeSnapshot(owner, repo, ref, directory =>
		countGitSnapshot(directory, "FETCH_HEAD", filter),
	);
}

function validatePath(path: string) {
	if (
		typeof path !== "string" ||
		!path ||
		path.length > 1024 ||
		path.includes("\0") ||
		path.split("/").some(part => !part || part === "." || part === "..")
	) {
		throw new HTTPError({ statusCode: 400, statusMessage: "Invalid file path" });
	}
}

export async function readGitSnapshotFile(directory: string, revision: string, path: string) {
	validatePath(path);
	const object = `${revision}:${path}`;
	let metadata: Buffer[];
	try {
		metadata = await Promise.all([
			git(directory, ["cat-file", "-t", object]),
			git(directory, ["cat-file", "-s", object]),
		]);
	} catch {
		throw new HTTPError({ statusCode: 404, statusMessage: "GitCode file not found" });
	}
	if (metadata[0].toString("ascii").trim() !== "blob") {
		throw new HTTPError({ statusCode: 404, statusMessage: "GitCode file not found" });
	}
	if (Number(metadata[1].toString("ascii").trim()) > MAX_FILE_BYTES) {
		throw new HTTPError({ statusCode: 413, statusMessage: "File exceeds the 2 MiB limit" });
	}
	return git(directory, ["cat-file", "blob", object], undefined, MAX_FILE_BYTES);
}

export function readGitCodeSnapshotFile(owner: string, repo: string, ref: string, path: string) {
	validatePath(path);
	return withGitCodeSnapshot(owner, repo, ref, directory =>
		readGitSnapshotFile(directory, "FETCH_HEAD", path),
	);
}
