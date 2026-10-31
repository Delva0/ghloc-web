import { useEffect, useMemo } from "hono/jsx";
import { FetchError } from "ofetch";
import useSWRImmutable from "swr/immutable";
import { ghlocApi, Locs, LocsChild } from "~/lib/ghloc/api";
import type { RepositoryProvider } from "~/lib/repository";
import { toast } from "~/lib/toasts/toasts";

export type SortOrder = "type" | "locs";

const EMPTY_LOCS: Locs = { loc: 0, locByLangs: {} };

export interface UseLocsOptions {
	sortOrder?: SortOrder;
	filter?: string;
	owner: string;
	repo: string;
	branch?: string;
	provider?: RepositoryProvider;
}

export function isFolder(child: LocsChild): child is Locs {
	return typeof child !== "number";
}

export function useLocs(
	path: string[],
	{ sortOrder, filter, owner, repo, branch, provider = "github" }: UseLocsOptions,
) {
	const { data, error, isValidating } = useSWRImmutable(
		["locs", provider, owner, repo, branch, filter],
		() => ghlocApi.getLocs({ owner, repo, branch, filter, provider }),
		{ keepPreviousData: true, shouldRetryOnError: false },
	);

	useEffect(() => {
		if (!error) {
			return;
		}

		let content: string;
		if (error instanceof FetchError) {
			content = `Failed to load LOC stats: ${error.data?.statusMessage ?? error.data?.error ?? error.data ?? error.message}`;
		} else {
			content = "Failed to load LOC stats.";
		}

		toast.show({ id: `locs-error:${provider}:${owner}/${repo}`, type: "error", content });
	}, [error]);

	const locs = error ? undefined : data;

	const pathLocs = useMemo<Locs | number | null>(() => {
		if (!locs) {
			return locs ?? null;
		}

		let pathLocs: Locs = locs;

		for (const dir of path) {
			if (!pathLocs.children || !Object.hasOwn(pathLocs.children, dir)) {
				return EMPTY_LOCS;
			}

			const child = pathLocs.children[dir];

			if (!isFolder(child)) {
				return child;
			}

			pathLocs = child;
		}

		return pathLocs;
	}, [locs, path]);

	const sortedLocs = useMemo((): Locs | number | null => {
		if (!pathLocs || !isFolder(pathLocs)) {
			return pathLocs;
		}

		const children = pathLocs.children;
		if (!children) {
			return pathLocs;
		}

		if (sortOrder === "locs") {
			return pathLocs;
		}

		const names = Object.keys(children);

		names.sort((nameA, nameB) => {
			const a = children[nameA] as Locs;
			const b = children[nameB] as Locs;

			const isFolderA = isFolder(a);
			const isFolderB = isFolder(b);

			if (isFolderA !== isFolderB) {
				return Number(isFolderB) - Number(isFolderA);
			}

			return nameA < nameB ? -1 : 1;
		});

		const sortedChildren: Record<string, LocsChild> = Object.create(null);
		for (const name of names) {
			sortedChildren[name] = children[name];
		}

		return { ...pathLocs, children: sortedChildren };
	}, [pathLocs, sortOrder]);

	return { locs: sortedLocs, isValidating, error };
}
