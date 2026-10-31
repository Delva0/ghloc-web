import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { HTTPError } from "nitro/h3";

export async function getPublicGitHubBranch(owner: string, repo: string) {
	if (![owner, repo].every(part => /^[\w.-]+$/.test(part) && part !== "." && part !== "..")) {
		throw new HTTPError({ statusCode: 400, statusMessage: "Invalid repository" });
	}
	let output: string;
	try {
		output = await new Promise<string>((resolve, reject) => {
			execFile(
				"git",
				[
					"-c",
					"credential.helper=",
					"-C",
					tmpdir(),
					"ls-remote",
					"--symref",
					`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`,
					"HEAD",
				],
				{
					timeout: 20_000,
					maxBuffer: 64 * 1024,
					windowsHide: true,
					env: {
						...process.env,
						GIT_TERMINAL_PROMPT: "0",
						GCM_INTERACTIVE: "Never",
						GIT_CONFIG_NOSYSTEM: "1",
						GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
					},
				},
				(error, stdout) => (error ? reject(error) : resolve(stdout)),
			);
		});
	} catch (error) {
		throw new HTTPError({
			statusCode: /not found|could not read Username|authentication failed/i.test(
				String(error),
			)
				? 404
				: 502,
			statusMessage: "Unable to read this public GitHub repository",
		});
	}
	if (!/^[a-f0-9]+\tHEAD$/m.test(output)) {
		throw new HTTPError({
			statusCode: 404,
			statusMessage: "Public repository has no HEAD commit",
		});
	}
	return output.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1] ?? "HEAD";
}

// Metadata is optional for line counting. A public Git ref can resolve the entry URL.
export async function resolveGitHubRepository<T extends { default_branch: string }>(
	readMetadata: () => Promise<T>,
	readPublicBranch: () => Promise<string>,
): Promise<{ data: T | null; defaultBranch: string }> {
	try {
		const data = await readMetadata();
		return { data, defaultBranch: data.default_branch };
	} catch {
		return { data: null, defaultBranch: await readPublicBranch() };
	}
}
