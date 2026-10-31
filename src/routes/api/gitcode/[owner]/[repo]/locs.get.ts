import { defineHandler, getQuery, getRouterParams, setHeader } from "nitro/h3";
import { REPOSITORY_CACHE_CONTROL } from "~/lib/cache-policy";
import { getGitCodeLocs } from "~/lib/gitcode/server";

export default defineHandler(async event => {
	const { owner, repo } = getRouterParams(event);
	const { branch, filter } = getQuery<{ branch?: string; filter?: string }>(event);
	const locs = await getGitCodeLocs(owner, repo, branch, filter);
	setHeader(event, "cache-control", REPOSITORY_CACHE_CONTROL);
	return locs;
});
