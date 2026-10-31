import { defineHandler, getQuery, getRouterParams, setHeader } from "nitro/h3";
import { REPOSITORY_CACHE_CONTROL, REPOSITORY_CACHE_SECONDS } from "~/lib/cache-policy";
import { humanize } from "~/lib/format";
import { getGitCodeLocs } from "~/lib/gitcode/server";

export default defineHandler(async event => {
	const { owner, repo } = getRouterParams(event);
	const { branch, filter, format } = getQuery<{
		branch?: string;
		filter?: string;
		format?: string;
	}>(event);
	const locs = await getGitCodeLocs(owner, repo, branch, filter);
	setHeader(event, "cache-control", REPOSITORY_CACHE_CONTROL);
	return {
		schemaVersion: 1,
		label: "lines",
		message: format === "human" ? humanize(locs.loc) : String(locs.loc),
		cacheSeconds: REPOSITORY_CACHE_SECONDS,
	};
});
