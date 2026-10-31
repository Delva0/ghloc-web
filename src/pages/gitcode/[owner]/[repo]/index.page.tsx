import { definePage } from "@pajecawav/yamf";
import { getQuery, HTTPError } from "nitro/h3";
import { Badge } from "~/components/Badge";
import { Link } from "~/components/Link";
import { RepoStats } from "~/components/RepoStats";
import { getGitCodeRepo } from "~/lib/gitcode/server";
import { buildPageTitle } from "~/lib/title";
import LocsSection from "../../../[owner]/[repo]/components/LocsSection/LocsSection.island";

export default definePage({
	render: async (event: any, { head }: any) => {
		const { owner, repo } = event.context.params ?? {};
		if (!owner || !repo) {
			throw new HTTPError({ statusCode: 400, statusMessage: "Missing repository" });
		}
		const data = await getGitCodeRepo(owner, repo);
		const { branch = data.default_branch || "HEAD", filter = "" } = getQuery<{
			branch?: string;
			filter?: string;
		}>(event);
		head.push({ title: buildPageTitle(`${owner}/${repo} · GitCode`) });
		return (
			<div class="flex flex-col gap-4">
				<div class="flex flex-wrap items-center gap-2">
					<Badge mode="accent">GitCode</Badge>
					<h1 class="text-xl">
						<Link
							href={`https://gitcode.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}
							target="_blank"
							rel="noopener"
						>
							{owner}/{repo}
						</Link>
					</h1>
					{data.stargazers_count !== undefined && (
						<RepoStats stars={data.stargazers_count} forks={data.forks_count} />
					)}
				</div>
				{data.description && <p>{data.description}</p>}
				<form class="flex flex-wrap items-center gap-2" method="get">
					<label for="gitcode-branch">Branch / tag / commit</label>
					<input
						id="gitcode-branch"
						name="branch"
						value={branch}
						class="rounded border border-border px-2 py-1"
						required
					/>
					{filter && <input type="hidden" name="filter" value={filter} />}
					<button
						type="submit"
						class="rounded border border-border px-3 py-1 hover:bg-tree-active"
					>
						Apply
					</button>
				</form>
				<p class="text-xs text-muted">
					HEAD follows the default branch. Counts non-empty UTF-8 lines, including
					comments; binary files count as 0.
				</p>
				<LocsSection
					owner={owner}
					repo={repo}
					branch={branch}
					data={null}
					provider="gitcode"
				/>
			</div>
		);
	},
});
