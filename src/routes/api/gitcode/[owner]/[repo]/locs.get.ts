import { defineHandler, getQuery, getRouterParams, setHeader } from "nitro/h3";
import { getGitCodeLocs } from "~/lib/gitcode/server";

export default defineHandler(async event => {
	const { owner, repo } = getRouterParams(event);
	const { branch, filter } = getQuery<{ branch?: string; filter?: string }>(event);
	const locs = await getGitCodeLocs(owner, repo, branch, filter);
	setHeader(event, "cache-control", "public, max-age=60");
	return locs;
});
