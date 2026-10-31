import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { HTTPError } from "nitro/h3";
import { buildLocs, createLineCounter, matchesFilter } from "./locs.ts";
import { createSnapshotCache } from "./snapshot-cache.ts";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PACK_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 100_000;
const gitEnvironment = {
	...process.env,
	GIT_TERMINAL_PROMPT: "0",
	GCM_INTERACTIVE: "Never",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
};

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
				env: gitEnvironment,
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

type GitFile = { path: string; sha: string; size: number };
type FileCount = { path: string; loc: number };

async function readTree(directory: string, revision: string): Promise<GitFile[]> {
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
			return type === "blob" && mode !== "120000" ? [{ path, sha, size: Number(size) }] : [];
		});
	if (files.length > MAX_FILES) {
		throw new HTTPError({
			statusCode: 413,
			statusMessage: "Repository exceeds the 100,000 file limit",
		});
	}
	return files;
}

async function countFiles(directory: string, files: GitFile[]): Promise<FileCount[]> {
	const unique = [...new Map(files.map(file => [file.sha, file])).values()];
	if (!unique.length) {
		return [];
	}
	const child = spawn(
		"git",
		[
			"-c",
			"credential.helper=",
			"-c",
			"core.packedGitLimit=32m",
			"-C",
			directory,
			"cat-file",
			"--batch",
		],
		{
			env: gitEnvironment,
			windowsHide: true,
			timeout: 120_000,
			killSignal: "SIGKILL",
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	let stderr = "";
	child.stderr.on("data", chunk => {
		if (stderr.length < 2000) {
			stderr += String(chunk);
		}
	});
	const completed = new Promise<void>((resolveResult, reject) => {
		child.once("error", reject);
		child.once("close", code =>
			code === 0 ? resolveResult() : reject(new Error(stderr || "Git blob reader failed")),
		);
	});
	void completed.catch(() => {});
	child.stdin.on("error", () => {
		/* exit status is checked below */
	});
	child.stdin.end(unique.map(file => file.sha).join("\n") + "\n");
	let index = 0;
	let header = "";
	let remaining = -1;
	let separator = false;
	let counter = createLineCounter();
	const counts = new Map<string, number>();
	try {
		for await (const chunk of child.stdout) {
			const bytes = chunk as Buffer;
			let offset = 0;
			while (offset < bytes.length) {
				if (separator) {
					if (bytes[offset++] !== 10) {
						throw new Error("Invalid Git blob separator");
					}
					separator = false;
					remaining = -1;
					index++;
				} else if (remaining < 0) {
					const newline = bytes.indexOf(10, offset);
					header += bytes
						.subarray(offset, newline < 0 ? bytes.length : newline)
						.toString("ascii");
					if (header.length > 128) {
						throw new Error("Invalid Git blob header");
					}
					if (newline < 0) {
						break;
					}
					const file = unique[index];
					if (!file || header !== `${file.sha} blob ${file.size}`) {
						throw new Error("Unexpected Git blob");
					}
					header = "";
					remaining = file.size;
					counter = createLineCounter();
					offset = newline + 1;
					if (remaining === 0) {
						counts.set(file.sha, counter.end());
						separator = true;
					}
				} else {
					const length = Math.min(remaining, bytes.length - offset);
					counter.write(bytes.subarray(offset, offset + length));
					offset += length;
					remaining -= length;
					if (remaining === 0) {
						counts.set(unique[index].sha, counter.end());
						separator = true;
					}
				}
			}
		}
		await completed;
		if (index !== unique.length || separator || header) {
			throw new Error("Incomplete Git file content");
		}
	} catch {
		child.kill("SIGKILL");
		throw new HTTPError({
			statusCode: 502,
			statusMessage: "Unable to finish reading Git file contents",
		});
	}
	return files.map(file => ({ path: file.path, loc: counts.get(file.sha)! }));
}

export async function countGitSnapshot(directory: string, revision: string, filter = "") {
	const files = (await readTree(directory, revision)).filter(file =>
		matchesFilter(file.path, filter),
	);
	return buildLocs(await countFiles(directory, files));
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

type Snapshot = { directory: string; counts?: Promise<FileCount[]> };

async function removeSnapshot(directory: string) {
	// All snapshots are fresh temporary bare repositories, with no checked-out source.
	if (
		resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
		directory.startsWith(join(tmpdir(), "ghloc-gitcode-"))
	) {
		await rm(directory, { recursive: true, force: true });
	}
}

const snapshots = createSnapshotCache<Snapshot>({
	async load(key) {
		const [owner, repo, ref] = JSON.parse(key) as string[];
		const started = Date.now();
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
					repositoryUrl(owner, repo),
					ref,
				]);
			} catch (error) {
				throw remoteError(error);
			}
			const packDirectory = join(directory, "objects", "pack");
			const sizes = await Promise.all(
				(await readdir(packDirectory)).map(
					async name => (await stat(join(packDirectory, name))).size,
				),
			);
			const packBytes = sizes.reduce((sum, size) => sum + size, 0);
			if (packBytes > MAX_PACK_BYTES) {
				throw new HTTPError({
					statusCode: 413,
					statusMessage: "Compressed repository exceeds the 256 MiB snapshot limit",
				});
			}
			console.info(
				"GitCode snapshot ready",
				JSON.stringify({ owner, repo, ref, packBytes, elapsedMs: Date.now() - started }),
			);
			return { directory };
		} catch (error) {
			await removeSnapshot(directory);
			throw error;
		}
	},
	dispose: snapshot => removeSnapshot(snapshot.directory),
});

function withGitCodeSnapshot<T>(
	owner: string,
	repo: string,
	ref: string,
	work: (snapshot: Snapshot) => Promise<T>,
) {
	validateRef(ref);
	repositoryUrl(owner, repo);
	return snapshots.withValue(JSON.stringify([owner, repo, ref]), work);
}

// Count one repository at a time; other readers share its promise and immutable index.
let countQueue: Promise<unknown> = Promise.resolve();

export function getGitCodeSnapshot(owner: string, repo: string, ref: string, filter: string) {
	return withGitCodeSnapshot(owner, repo, ref, async snapshot => {
		if (!snapshot.counts) {
			snapshot.counts = countQueue
				.then(async () => {
					const started = Date.now();
					const files = await countFiles(
						snapshot.directory,
						await readTree(snapshot.directory, "FETCH_HEAD"),
					);
					console.info(
						"GitCode file counts ready",
						JSON.stringify({
							owner,
							repo,
							ref,
							files: files.length,
							elapsedMs: Date.now() - started,
						}),
					);
					return files;
				})
				.catch(error => {
					snapshot.counts = undefined;
					throw error;
				});
			countQueue = snapshot.counts.catch(() => {});
		}
		return buildLocs((await snapshot.counts).filter(file => matchesFilter(file.path, filter)));
	});
}

export const clearGitCodeSnapshots = () => snapshots.clear();

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
	return withGitCodeSnapshot(owner, repo, ref, snapshot =>
		readGitSnapshotFile(snapshot.directory, "FETCH_HEAD", path),
	);
}
