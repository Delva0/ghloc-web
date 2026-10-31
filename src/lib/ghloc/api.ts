import { cachedApiFunction } from "../cache";
import { baseFetcher } from "../fetcher";
import { gitcodeApiUrl, type RepositoryProvider } from "../repository";

export type LocsChild = Locs | number;

export interface Locs {
	loc: number;
	locByLangs?: Record<string, number>;
	children?: Record<string, LocsChild>;
}

export type GhlocApiGetLocsResponse = Locs;

export interface GhlocApiGetLocsParams {
	owner: string;
	repo: string;
	branch?: string;
	filter?: string;
	provider?: RepositoryProvider;
}

export const getGhlocGetLocsUrl = ({ owner, repo, branch, filter }: GhlocApiGetLocsParams) => {
	const url = new URL(`https://ghloc.ifels.dev/${owner}/${repo}`);

	if (branch) {
		url.pathname += `/${encodeURIComponent(branch)}`;
	}

	if (filter) {
		url.searchParams.set("match", filter);
	}

	url.searchParams.set("pretty", "false");

	return url;
};

export const ghlocApi = {
	getLocs: cachedApiFunction("ghlocApi.getLocs", (params: GhlocApiGetLocsParams) => {
		if (params.provider === "gitcode") {
			const url = gitcodeApiUrl(params.owner, params.repo, "locs", params.branch);
			return baseFetcher<GhlocApiGetLocsResponse>(url, { query: { filter: params.filter } });
		}
		const url = getGhlocGetLocsUrl(params);

		return baseFetcher<GhlocApiGetLocsResponse>(url.toString());
	}),
};
