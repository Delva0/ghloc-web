import assert from "node:assert/strict";
import test from "node:test";
import { resolveGitHubRepository } from "../src/lib/github/public-repo.ts";

void test("GitHub entry uses API metadata when available", async () => {
	const data = { default_branch: "main", description: "repo" };
	assert.deepEqual(
		await resolveGitHubRepository(
			async () => data,
			async () => {
				throw new Error("Git fallback should not run");
			},
		),
		{ data, defaultBranch: "main" },
	);
});

void test("GitHub 403 and network failures do not block public repository entries", async () => {
	for (const error of [
		Object.assign(new Error("API rate limited"), { statusCode: 403 }),
		new Error("network unavailable"),
	]) {
		assert.deepEqual(
			await resolveGitHubRepository(
				async () => {
					throw error;
				},
				async () => "master",
			),
			{ data: null, defaultBranch: "master" },
		);
	}
});

void test("missing or private GitHub repositories remain errors", async () => {
	await assert.rejects(
		resolveGitHubRepository(
			async () => {
				throw new Error("metadata denied");
			},
			async () => {
				throw Object.assign(new Error("not public"), { statusCode: 404 });
			},
		),
		{ statusCode: 404 },
	);
});
