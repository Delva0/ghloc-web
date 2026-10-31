import { defineHandler, getQuery, getRouterParams, setHeader } from "nitro/h3";
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
	setHeader(event, "cache-control", "public, max-age=60");
	return {
		schemaVersion: 1,
		label: "lines",
		message: format === "human" ? humanize(locs.loc) : String(locs.loc),
		cacheSeconds: 300,
	};
});
