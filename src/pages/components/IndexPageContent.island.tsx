import { useEffect, useLayoutEffect, useRef, useState } from "hono/jsx";
import useSWRImmutable from "swr/immutable";
import { useSearchParams } from "wouter";
import { SearchIcon } from "~/components/icons/SearchIcon";
import { SpinnerIcon } from "~/components/icons/SpinnerIcon";
import { Input } from "~/components/Input";
import { Select } from "~/components/Select";
import { useDebouncedValue } from "~/lib/debounce";
import { ghApi } from "~/lib/github/api";
import { parseRepositoryInput, type RepositoryProvider } from "~/lib/repository";
import { cn } from "~/lib/utils";
import { SearchResults } from "./SearchResults";

export default function IndexPageContent({ placeholder }: { placeholder: string }) {
	const [searchParams, setSearchParams] = useSearchParams();

	const inputRef = useRef<HTMLInputElement>(null);
	const queryValue = searchParams.get("query") ?? "";
	const provider: RepositoryProvider =
		searchParams.get("provider") === "gitcode" ? "gitcode" : "github";
	const directRepo = parseRepositoryInput(queryValue, provider);
	const activeProvider = directRepo?.provider ?? provider;
	const [debouncedQuery, setDebouncedQuery] = useDebouncedValue(queryValue, 750);

	const [activeIndex, setActiveIndex] = useState(0);

	const { data, isValidating } = useSWRImmutable(
		debouncedQuery && activeProvider === "github" ? ["searchRepos", debouncedQuery] : null,
		() => ghApi.searchRepos(debouncedQuery),
		{ keepPreviousData: true },
	);

	useEffect(() => {
		inputRef.current?.focus();

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				inputRef.current?.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown);

		return () => {
			document.removeEventListener("keydown", onKeyDown);
		};
	}, []);

	useLayoutEffect(() => {
		setActiveIndex(0);
	}, [data]);

	const onChange = (e: Event) => {
		if (e.target instanceof HTMLInputElement) {
			let newQuery = e.target.value;

			const parsed = parseRepositoryInput(newQuery, provider);
			if (parsed) {
				newQuery = `${parsed.owner}/${parsed.repo}`;
				setDebouncedQuery(newQuery);
			}

			setSearchParams(prev => {
				prev.set("query", newQuery);
				if (parsed) {
					prev.set("provider", parsed.provider);
				}

				return prev;
			});
		}
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			if (directRepo) {
				location.href = directRepo.href;
				return;
			}
			const item = data?.items[activeIndex];

			if (item) {
				location.href = `/${item.full_name}?branch=${encodeURIComponent(item.default_branch)}`;
			}
		} else if (e.key === "ArrowDown") {
			setActiveIndex(Math.min(activeIndex + 1, (data?.items.length ?? 1) - 1));
			e.preventDefault();
		} else if (e.key === "ArrowUp") {
			setActiveIndex(Math.max(activeIndex - 1, 0));
			e.preventDefault();
		}
	};

	return (
		<div class="group mx-auto flex w-full max-w-xl flex-grow flex-col gap-4 md:justify-center">
			<div class="max-h-0.5 flex-grow md:max-h-16" />

			<h1 class="text-center text-lg">
				Count lines of code in a GitHub or GitCode repository
			</h1>
			<Select
				aria-label="Repository platform"
				value={activeProvider}
				onChange={e => {
					if (e.target instanceof HTMLSelectElement) {
						const nextProvider = e.target.value;
						setSearchParams(prev => {
							prev.set("provider", nextProvider);
							return prev;
						});
					}
				}}
			>
				<option value="github">GitHub</option>
				<option value="gitcode">GitCode</option>
			</Select>

			<div class="flex-shrink-0">
				<Input
					onKeyDown={onKeyDown}
					ref={inputRef}
					value={queryValue}
					onChange={onChange}
					inputClass="py-3 text-center text-2xl font-light"
					type="text"
					placeholder={
						activeProvider === "gitcode" ? "gitcode.com/owner/repo" : placeholder
					}
					aria-label="Repository URL or owner/repo"
					autofocus
					autocomplete="off"
					autocorrect="off"
					autocapitalize="off"
					spellcheck={false}
					after={
						<div
							class={cn(
								"h-8 w-8 transition-colors duration-100",
								"text-neutral-400 group-focus-within:text-black dark:text-neutral-500 dark:group-focus-within:text-neutral-400",
							)}
						>
							{isValidating ? <SpinnerIcon class="animate-spin" /> : <SearchIcon />}
						</div>
					}
				/>
			</div>

			<div class="h-0 flex-grow md:max-h-[36rem]">
				{directRepo && (
					<a
						class="mb-2 block rounded-md border border-border px-6 py-3 hover:bg-tree-active"
						href={directRepo.href}
					>
						Open {activeProvider === "gitcode" ? "GitCode" : "GitHub"}:{" "}
						{directRepo.owner}/{directRepo.repo} →
					</a>
				)}
				{activeProvider === "gitcode" ? (
					<p class="text-center text-sm text-muted">
						Enter a public GitCode repository URL or owner/repo, then press Enter.
					</p>
				) : (
					<SearchResults
						activeIndex={activeIndex}
						onChangeActiveIndex={setActiveIndex}
						items={data?.items}
					/>
				)}
			</div>
		</div>
	);
}
