import { defineErrorHandler } from "nitro";
import type { NitroErrorHandler } from "nitro/types";

const errorHandler: NitroErrorHandler = defineErrorHandler(error => {
	console.error(error);
	return new Response(`${error.statusCode} ${error.statusMessage ?? "Something went wrong"}`, {
		status: error.statusCode ?? 500,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
});

export default errorHandler;
