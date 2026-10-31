import assert from "node:assert/strict";
import test from "node:test";
import { enrichGitCodeRepo } from "../src/lib/gitcode/server.ts";

void test("optional metadata cannot block a public Git repository", async t => {
	const originalFetch = globalThis.fetch;
	const originalToken = process.env.NITRO_GITCODE_TOKEN;
	t.after(() => {
		globalThis.fetch = originalFetch;
		if (originalToken === undefined) {
			delete process.env.NITRO_GITCODE_TOKEN;
		} else {
			process.env.NITRO_GITCODE_TOKEN = originalToken;
		}
	});
	const repo = { default_branch: "main" };
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return new Response("{}", { status: 429 });
	};
	delete process.env.NITRO_GITCODE_TOKEN;
	assert.deepEqual(await enrichGitCodeRepo("test", "repo", repo), repo);
	assert.equal(calls, 0, "anonymous API must not be called");
	process.env.NITRO_GITCODE_TOKEN = "test-token";
	assert.deepEqual(await enrichGitCodeRepo("test", "repo", repo), repo);
	assert.equal(calls, 1, "rate limiting is a metadata-only failure");
	globalThis.fetch = async () => {
		throw new Error("network unavailable");
	};
	assert.deepEqual(await enrichGitCodeRepo("test", "repo", repo), repo);
	globalThis.fetch = async () =>
		Response.json({ private: true, description: "private metadata" });
	assert.deepEqual(await enrichGitCodeRepo("test", "repo", repo), repo);
	globalThis.fetch = async () =>
		Response.json({
			default_branch: "wrong",
			description: "public description",
			stargazers_count: 5,
		});
	assert.deepEqual(await enrichGitCodeRepo("test", "repo", repo), {
		...repo,
		description: "public description",
		stargazers_count: 5,
	});
});
