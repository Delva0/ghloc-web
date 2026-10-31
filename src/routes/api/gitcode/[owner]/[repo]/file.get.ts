import { defineHandler, getQuery, getRouterParams, setHeader } from "nitro/h3";
import { REPOSITORY_CACHE_CONTROL } from "~/lib/cache-policy";
import { getGitCodeFile } from "~/lib/gitcode/server";

export default defineHandler(async event => {
	const { owner, repo } = getRouterParams(event);
	const { branch = "HEAD", path = "" } = getQuery<{ branch?: string; path?: string }>(event);
	const content = await getGitCodeFile(owner, repo, branch, path);
	setHeader(event, "content-type", "text/plain; charset=utf-8");
	setHeader(event, "x-content-type-options", "nosniff");
	setHeader(event, "cache-control", REPOSITORY_CACHE_CONTROL);
	return content;
});
