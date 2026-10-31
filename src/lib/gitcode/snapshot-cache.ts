import { HTTPError } from "nitro/h3";

// Leases prevent eviction while a count or preview is using the bare snapshot.
export function createSnapshotCache<T>({
	load,
	dispose,
	maxEntries = 2,
	ttl = 5 * 60_000,
	now = Date.now,
}: {
	load: (key: string) => Promise<T>;
	dispose: (value: T) => Promise<void>;
	maxEntries?: number;
	ttl?: number;
	now?: () => number;
}) {
	type Entry = {
		value: Promise<T>;
		users: number;
		expires: number;
		timer?: ReturnType<typeof setTimeout>;
	};
	const entries = new Map<string, Entry>();
	const remove = async (key: string, entry: Entry) => {
		if (entries.get(key) !== entry) {
			return;
		}
		entries.delete(key);
		clearTimeout(entry.timer);
		try {
			await dispose(await entry.value);
		} catch {
			/* failed loads clean up their own directory */
		}
	};
	return {
		async withValue<R>(key: string, work: (value: T) => Promise<R>): Promise<R> {
			const cleanup: Promise<void>[] = [];
			for (const [oldKey, entry] of entries) {
				if (entry.users === 0 && entry.expires <= now()) {
					cleanup.push(remove(oldKey, entry));
				}
			}
			let entry = entries.get(key);
			if (!entry) {
				if (entries.size >= maxEntries) {
					const idle = [...entries].find(([, value]) => value.users === 0);
					if (!idle) {
						throw new HTTPError({
							statusCode: 503,
							statusMessage: "Repository workers are busy. Please retry shortly.",
						});
					}
					cleanup.push(remove(...idle));
				}
				const created: Entry = {
					users: 0,
					expires: Infinity,
					value: Promise.resolve().then(async () => {
						await Promise.all(cleanup);
						const value = await load(key);
						created.expires = now() + ttl;
						created.timer = setTimeout(() => {
							if (created.users === 0) {
								void remove(key, created);
							}
						}, ttl);
						created.timer.unref();
						return value;
					}),
				};
				entry = created;
				entries.set(key, entry);
			}
			entry.users++;
			try {
				return await work(await entry.value);
			} catch (error) {
				// A work error (e.g. missing preview) must not invalidate a valid snapshot.
				if (entry.expires === Infinity) {
					void remove(key, entry);
				}
				throw error;
			} finally {
				entry.users--;
				if (entry.users === 0 && entry.expires <= now()) {
					await remove(key, entry);
				}
			}
		},
		async clear() {
			await Promise.all(
				[...entries]
					.filter(([, entry]) => entry.users === 0)
					.map(([key, entry]) => remove(key, entry)),
			);
		},
	};
}
