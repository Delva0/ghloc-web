import assert from "node:assert/strict";
import test from "node:test";
import { getGitCodeLocs, getGitCodeRepo } from "../src/lib/gitcode/server.ts";

const originalFetch = globalThis.fetch;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

void test("GitCode API pagination, failure handling and public access", async t => {
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	await t.test("reads every page and counts all 150 matching files", async () => {
		const pages: number[] = [];
		globalThis.fetch = async input => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname.endsWith("/git/trees/HEAD") && !url.searchParams.has("recursive")) {
				return json({ tree: [] });
			}
			if (url.pathname.includes("/git/trees/")) {
				const page = Number(url.searchParams.get("page"));
				pages.push(page);
				return json({
					tree: Array.from({ length: page === 1 ? 100 : 50 }, (_, i) => ({
						path: `src/${(page - 1) * 100 + i}.ts`,
						type: "blob",
						sha: String(i),
					})),
				});
			}
			if (url.pathname.includes("/raw/")) {
				return new Response("one\n\ntwo\n");
			}
			return json({}, 401);
		};
		const locs = await getGitCodeLocs("test", "pagination");
		assert.equal(locs.loc, 300);
		assert.equal((locs.children!.src as typeof locs).loc, 300);
		assert.deepEqual(pages, [1, 2]);
	});
	await t.test("rejects a failed file request instead of returning a partial total", async () => {
		globalThis.fetch = async input => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname.includes("/git/trees/")) {
				return json({ tree: [{ path: "missing.ts", type: "blob", sha: "1" }] });
			}
			return url.pathname.includes("/raw/") ? json({}, 404) : json({}, 401);
		};
		await assert.rejects(getGitCodeLocs("test", "missing-file"), { statusCode: 404 });
	});
	await t.test("proves anonymous repository access before authenticated metadata", async () => {
		let calls = 0;
		globalThis.fetch = async () => {
			calls++;
			return json({}, 401);
		};
		await assert.rejects(getGitCodeRepo("test", "private-repo"), { statusCode: 401 });
		assert.equal(calls, 1);
	});
	await t.test("detects an upstream that ignores the page parameter", async () => {
		const entries = Array.from({ length: 100 }, (_, i) => ({
			path: `${i}.ts`,
			type: "blob",
			sha: String(i),
		}));
		globalThis.fetch = async input => {
			const url = new URL(input instanceof Request ? input.url : input.toString());
			if (url.pathname.includes("/git/trees/")) {
				return json({ tree: url.searchParams.has("recursive") ? entries : [] });
			}
			return json({}, 401);
		};
		await assert.rejects(getGitCodeLocs("test", "duplicate-page"), { statusCode: 502 });
	});
});
