import type { Locs } from "../ghloc/api";

// Match ghloc's ordered, literal path filters (optional ^, $, and !).
export function matchesFilter(path: string, filter = "") {
	const rules = filter.split(",").filter(Boolean);
	let included = !rules.some(rule => !rule.startsWith("!"));
	for (const rule of rules) {
		const exclude = rule.startsWith("!");
		const pattern = exclude ? rule.slice(1) : rule;
		const start = pattern.startsWith("^");
		const end = pattern.endsWith("$");
		const text = pattern.slice(start ? 1 : 0, end ? -1 : undefined);
		const matches =
			start && end
				? path === text
				: start
					? path.startsWith(text)
					: end
						? path.endsWith(text)
						: path.includes(text);
		if (matches) {
			included = !exclude;
		}
	}
	return included;
}

export function countLines(content: Uint8Array): number {
	const counter = createLineCounter();
	counter.write(content);
	return counter.end();
}

export function createLineCounter() {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let binary = false;
	let lines = 0;
	let pending = false;
	const consume = (text: string) => {
		const parts = text.split("\n");
		for (let index = 0; index < parts.length; index++) {
			pending ||= parts[index].trim().length > 0;
			if (index < parts.length - 1) {
				if (pending) {
					lines++;
				}
				pending = false;
			}
		}
	};
	return {
		write(bytes: Uint8Array) {
			if (binary) {
				return;
			}
			if (bytes.includes(0)) {
				binary = true;
				return;
			}
			try {
				consume(decoder.decode(bytes, { stream: true }));
			} catch {
				binary = true;
			}
		},
		end() {
			if (binary) {
				return 0;
			}
			try {
				consume(decoder.decode());
			} catch {
				return 0;
			}
			return lines + Number(pending);
		},
	};
}

export function buildLocs(files: { path: string; loc: number }[]): Locs {
	const root: Locs = { loc: 0, locByLangs: Object.create(null), children: Object.create(null) };
	for (const file of files) {
		const parts = file.path.split("/");
		if (parts.some(part => !part || part === "." || part === "..")) {
			continue;
		}
		const name = parts.pop()!;
		const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
		let node = root;
		for (const part of parts) {
			node.loc += file.loc;
			node.locByLangs![extension] = (node.locByLangs![extension] ?? 0) + file.loc;
			if (!Object.hasOwn(node.children!, part)) {
				node.children![part] = {
					loc: 0,
					locByLangs: Object.create(null),
					children: Object.create(null),
				};
			}
			node = node.children![part] as Locs;
		}
		node.loc += file.loc;
		node.locByLangs![extension] = (node.locByLangs![extension] ?? 0) + file.loc;
		node.children![name] = file.loc;
	}
	const sort = (node: Locs) => {
		node.locByLangs = Object.fromEntries(
			Object.entries(node.locByLangs!).toSorted((a, b) => b[1] - a[1]),
		);
		node.children = Object.fromEntries(
			Object.entries(node.children!).toSorted(
				(a, b) =>
					(typeof b[1] === "number" ? b[1] : b[1].loc) -
					(typeof a[1] === "number" ? a[1] : a[1].loc),
			),
		);
		for (const child of Object.values(node.children)) {
			if (typeof child !== "number") {
				sort(child);
			}
		}
	};
	sort(root);
	return root;
}
