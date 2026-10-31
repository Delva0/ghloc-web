import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	countGitSnapshot,
	readGitSnapshotFile,
	MAX_FILE_BYTES,
	validateRef,
} from "../src/lib/gitcode/snapshot.ts";

void test("counts an immutable Git tree in bulk without HTTP requests", async t => {
	const directory = await mkdtemp(join(tmpdir(), "ghloc-snapshot-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", directory, ...args], { stdio: "pipe" });
	git("init");
	await mkdir(join(directory, "src"));
	for (let i = 0; i < 150; i++) {
		await writeFile(join(directory, "src", `${i}.ts`), "one\n\ntwo\n");
	}
	await writeFile(join(directory, "README.md"), "readme\n");
	await writeFile(join(directory, "binary.bin"), new Uint8Array([1, 0, 2]));
	git("add", ".");
	git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture");
	await t.test("includes all 150 nested files and ignores binary lines", async () => {
		const locs = await countGitSnapshot(directory, "HEAD");
		assert.equal(locs.loc, 301);
		assert.equal((locs.children!.src as typeof locs).loc, 300);
		assert.equal(locs.children!["binary.bin"], 0);
	});
	await t.test("applies the filter before reading blobs", async () => {
		const locs = await countGitSnapshot(directory, "HEAD", "^README.md$");
		assert.equal(locs.loc, 1);
		assert.deepEqual(Object.keys(locs.children!), ["README.md"]);
	});
	await t.test("does not count unstaged edits", async () => {
		await writeFile(join(directory, "README.md"), "changed\nchanged\n");
		assert.equal((await countGitSnapshot(directory, "HEAD", "^README.md$")).loc, 1);
	});
	await t.test("previews committed files and returns real file errors", async () => {
		assert.equal(
			(await readGitSnapshotFile(directory, "HEAD", "README.md")).toString(),
			"readme\n",
		);
		assert.equal(
			(await readGitSnapshotFile(directory, "HEAD", "src/0.ts")).toString(),
			"one\n\ntwo\n",
		);
		assert.deepEqual(
			await readGitSnapshotFile(directory, "HEAD", "binary.bin"),
			Buffer.from([1, 0, 2]),
		);
		await assert.rejects(readGitSnapshotFile(directory, "HEAD", "missing.txt"), {
			statusCode: 404,
		});
		await assert.rejects(readGitSnapshotFile(directory, "HEAD", "../README.md"), {
			statusCode: 400,
		});
	});
	await t.test("rejects oversized files and still permits a narrow filter", async () => {
		await writeFile(join(directory, "large.txt"), new Uint8Array(MAX_FILE_BYTES + 1));
		git("add", "large.txt");
		git(
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-m",
			"large fixture",
		);
		await assert.rejects(countGitSnapshot(directory, "HEAD"), { statusCode: 413 });
		await assert.rejects(readGitSnapshotFile(directory, "HEAD", "large.txt"), {
			statusCode: 413,
		});
		assert.equal((await countGitSnapshot(directory, "HEAD", "^README.md$")).loc, 1);
	});
});

void test("validates refs before invoking Git", () => {
	for (const ref of [
		"HEAD",
		"feature/api",
		"v1.0.0",
		"2ae82839ecaaa7d031e66ccbd2076d671acfd615",
	]) {
		assert.doesNotThrow(() => validateRef(ref));
	}
	for (const ref of [
		"--upload-pack=bad",
		"HEAD:refs/heads/other",
		"../HEAD",
		"refs/*",
		"HEAD\nother",
	]) {
		assert.throws(() => validateRef(ref), { statusCode: 400 });
	}
});
