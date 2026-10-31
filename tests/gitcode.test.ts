import assert from "node:assert/strict";
import test from "node:test";
import { buildLocs, countLines, matchesFilter } from "../src/lib/gitcode/locs.ts";
import { gitcodeApiUrl, parseRepositoryInput } from "../src/lib/repository.ts";

void test("repository URLs choose the correct provider and strip .git", () => {
	assert.deepEqual(parseRepositoryInput("https://gitcode.com/openharmony/docs.git?x=1"), {
		owner: "openharmony",
		repo: "docs",
		provider: "gitcode",
		href: "/gitcode/openharmony/docs",
	});
	assert.equal(parseRepositoryInput("facebook/react")?.href, "/facebook/react");
	assert.equal(parseRepositoryInput("openharmony/docs", "gitcode")?.provider, "gitcode");
	assert.equal(
		parseRepositoryInput("https://github.com/pajecawav/ghloc-web")?.provider,
		"github",
	);
	assert.equal(parseRepositoryInput("https://gitcode.com.evil.example/owner/repo"), null);
	assert.equal(parseRepositoryInput("../repo"), null);
});

void test("branch and file names stay in encoded query parameters", () => {
	const url = new URL(
		gitcodeApiUrl("team", "repo", "file", "feature/api", "src/a #?.ts"),
		"https://example.com",
	);
	assert.equal(url.searchParams.get("branch"), "feature/api");
	assert.equal(url.searchParams.get("path"), "src/a #?.ts");
});

void test("literal ordered filters include, exclude and override", () => {
	assert.equal(matchesFilter("src/index.ts", ".ts$,.tsx$"), true);
	assert.equal(matchesFilter("src/index.js", ".ts$,.tsx$"), false);
	assert.equal(matchesFilter("src/indexXts", ".ts$"), false);
	assert.equal(matchesFilter("src/index.test.ts", "!test,!.lock"), false);
	assert.equal(matchesFilter("src/index.ts", "!test,!.lock"), true);
	assert.equal(matchesFilter("README.md", "!.md$,^README.md$"), true);
	assert.equal(matchesFilter("docs/README.md", "!.md$,^README.md$"), false);
	assert.equal(matchesFilter("src/main.ts", "^src/"), true);
});

void test("counts non-empty UTF-8 lines, including comments, and ignores binary", () => {
	assert.equal(countLines(new TextEncoder().encode("// comment\r\n\r\n代码\n  \nlast")), 3);
	assert.equal(countLines(new Uint8Array()), 0);
	assert.equal(countLines(new Uint8Array([65, 0, 66])), 0);
	assert.equal(countLines(new Uint8Array([255, 254])), 0);
});

void test("aggregates nested totals and extensions without prototype path collisions", () => {
	const tree = buildLocs([
		{ path: "src/a.ts", loc: 3 },
		{ path: "src/b.ts", loc: 2 },
		{ path: "README.md", loc: 4 },
		{ path: "__proto__/constructor", loc: 1 },
		{ path: "image.png", loc: 0 },
	]);
	assert.equal(tree.loc, 10);
	assert.equal((tree.children!.src as typeof tree).loc, 5);
	assert.deepEqual(tree.locByLangs, { ts: 5, md: 4, constructor: 1, png: 0 });
	assert.equal((tree.children!.__proto__ as typeof tree).loc, 1);
	assert.equal(tree.children!["image.png"], 0);
	assert.equal(buildLocs([{ path: "../bad.ts", loc: 99 }]).loc, 0);
});
