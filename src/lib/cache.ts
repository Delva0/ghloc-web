import { defineCachedFunction } from "ocache";
import { REPOSITORY_CACHE_SECONDS } from "./cache-policy";

export const cachedApiFunction = <TArgs extends unknown[], TResult>(
	name: string,
	fn: (...args: TArgs) => Promise<TResult>,
) => {
	if (import.meta.env.SSR) {
		return defineCachedFunction(fn, { name, maxAge: REPOSITORY_CACHE_SECONDS, swr: false });
	}

	return fn;
};
