import assert from "node:assert/strict";
import test from "node:test";
import { countLines, createLineCounter } from "../src/lib/gitcode/locs.ts";
import { createSnapshotCache } from "../src/lib/gitcode/snapshot-cache.ts";

void test("snapshot leases reuse downloads, expire and protect active readers", async t => {
	let loads = 0;
	let now = 0;
	const disposed: number[] = [];
	const cache = createSnapshotCache({
		maxEntries: 1,
		ttl: 1000,
		now: () => now,
		load: async () => ++loads,
		dispose: async value => {
			disposed.push(value);
		},
	});
	t.after(() => cache.clear());
	let release!: () => void;
	const barrier = new Promise<void>(resolve => {
		release = resolve;
	});
	const active = cache.withValue("repo@main", async value => {
		await barrier;
		return value;
	});
	assert.equal(await cache.withValue("repo@main", async value => value), 1);
	await assert.rejects(
		cache.withValue("other@main", async value => value),
		{ statusCode: 503 },
	);
	release();
	assert.equal(await active, 1);
	await assert.rejects(
		cache.withValue("repo@main", async () => {
			throw new Error("missing file");
		}),
		/missing file/,
	);
	assert.equal(await cache.withValue("repo@main", async value => value), 1);
	assert.equal(loads, 1, "counts, filters and previews reuse the same resource");
	now = 1001;
	assert.equal(await cache.withValue("repo@main", async value => value), 2);
	assert.deepEqual(disposed, [1]);
	assert.equal(await cache.withValue("other@main", async value => value), 3);
	assert.deepEqual(disposed, [1, 2]);
});

void test("failed snapshot downloads can be retried", async t => {
	let loads = 0;
	const cache = createSnapshotCache({
		load: async () => {
			if (++loads === 1) {
				throw new Error("fetch failed");
			}
			return "ready";
		},
		dispose: async () => {},
	});
	t.after(() => cache.clear());
	await assert.rejects(
		cache.withValue("repo", async value => value),
		/fetch failed/,
	);
	assert.equal(await cache.withValue("repo", async value => value), "ready");
});

void test("streamed UTF-8 counting handles split characters and binary detection", () => {
	for (const text of [
		"a\r\n \n中文\nlast",
		"one long line".repeat(10000),
		"\uFEFF \n\t\r\n",
		"",
		"\n\n",
	]) {
		const bytes = new TextEncoder().encode(text);
		for (const chunkSize of [1, 7, 65536]) {
			const counter = createLineCounter();
			for (let offset = 0; offset < bytes.length; offset += chunkSize) {
				counter.write(bytes.subarray(offset, offset + chunkSize));
			}
			assert.equal(counter.end(), text.split(/\r?\n/).filter(line => line.trim()).length);
		}
		assert.equal(countLines(bytes), text.split(/\r?\n/).filter(line => line.trim()).length);
	}
	for (const bytes of [new Uint8Array([65, 10, 0]), new Uint8Array([65, 10, 0xc3])]) {
		const counter = createLineCounter();
		for (const byte of bytes) {
			counter.write(new Uint8Array([byte]));
		}
		assert.equal(counter.end(), 0);
	}
});
