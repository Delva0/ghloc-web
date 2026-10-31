export type RepositoryProvider = "github" | "gitcode";

export function parseRepositoryInput(input: string, provider: RepositoryProvider = "github") {
	let value = input.trim();
	if (/^(?:https?:\/\/)?(?:www\.)?(?:github|gitcode)\.com\//i.test(value)) {
		const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
		provider =
			url.hostname.replace(/^www\./, "").toLowerCase() === "gitcode.com"
				? "gitcode"
				: "github";
		value = url.pathname;
	}
	const parts = value.replace(/^\/+|\/+$/g, "").split("/");
	const owner = parts[0];
	const repo = parts[1]?.replace(/\.git$/i, "");
	if (
		!owner ||
		!repo ||
		!/^[\w.-]+$/.test(owner) ||
		!/^[\w.-]+$/.test(repo) ||
		[owner, repo].some(part => part === "." || part === "..")
	) {
		return null;
	}
	const prefix = provider === "gitcode" ? "/gitcode" : "";
	return {
		owner,
		repo,
		provider,
		href: `${prefix}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
	};
}

export function gitcodeApiUrl(
	owner: string,
	repo: string,
	action: string,
	branch?: string,
	path?: string,
) {
	const url = new URL(
		`/api/gitcode/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${action}`,
		"http://localhost",
	);
	if (branch) {
		url.searchParams.set("branch", branch);
	}
	if (path) {
		url.searchParams.set("path", path);
	}
	return url.pathname + url.search;
}
