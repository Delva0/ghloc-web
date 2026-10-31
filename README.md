# ghloc-web

This fork adds **GitCode** support alongside the original GitHub pages.

## GitCode

Choose GitCode on the home page and enter `owner/repo`, or paste a full
`https://gitcode.com/owner/repo` URL. Direct links use `/gitcode/OWNER/REPO`.
The branch field accepts a branch, tag, or commit; `HEAD` follows the default branch.
Repository pages, file trees, extension totals, and text previews use anonymous Git
transport. Only optional authenticated descriptions use GitCode's API. The server requires Git,
which is included in Render's native Node runtime.

Counts include non-empty UTF-8 lines, including comments. Binary files count as zero;
symlinks and submodules are excluded. Filters use ghloc's ordered literal matching:
`.ts$,.tsx$`, `!test,!.lock`, or `^src/`. The server reads the complete Git tree
and never returns partial totals after a failed request. File contents are streamed
through a UTF-8 line counter instead of buffering an entire repository in memory.
The old 2,000-file, 2 MiB counting-file and 50 MiB content limits are removed;
text previews retain a 2 MiB limit. Snapshots support up to 100,000 regular files
and 256 MiB compressed Git data each.

Bulk counting uses one snapshot fetch rather than one API request per file, avoiding
GitCode's anonymous API rate limits. Two bare snapshots are cached for one day,
with active readers protected from eviction. Filters and previews reuse the same
snapshot, and filtered totals reuse a cached per-file line index. Counting jobs run
one at a time. Snapshot fetches have a 60-second timeout and blob reading has a
120-second timeout; no repository code is checked out or executed.

Public repositories work without a token. Optional `NITRO_GITCODE_TOKEN` enables
repository descriptions and metadata; API errors never block the core features. Tokens stay on the server; all file reads
must also succeed anonymously, so this public application never exposes private repositories.
GitHub-specific health, npm package and commit activity panels remain on GitHub pages.
If GitHub metadata is unavailable, public default branches are resolved using Git
so repository entry URLs and external line-counting still work without an API token.
GitHub server-side queries, GitCode query results and snapshots share a 24-hour
cache lifetime. Statistics, preview and badge API responses also allow caching for
86,400 seconds. The existing capacity limits still apply; instance restarts or
capacity eviction can remove cached entries before their expiry.

GitCode badge endpoint: `/api/gitcode/OWNER/REPO/badge?branch=HEAD&filter=.ts$`.
It returns the same shields.io endpoint format as the original GitHub badges.

## Render deployment

Create a single **Node web service**, using this fork's `master` branch:

- Build: `npx --yes pnpm@12.13.0 install --frozen-lockfile --prod=false && npx --yes pnpm@12.13.0 build`
- Start: `node .output/server/index.mjs`
- Environment: `HOST=0.0.0.0`, `NODE_ENV=production`
- Health check: `/health`
- Use the Free compute plan for a personal deployment.

The Node version is pinned in `.node-version`; pnpm is pinned in `package.json`.
Nitro's Node server listens on Render's `PORT`. No database or disk is needed.
For local validation, run `pnpm test`, `pnpm build:languages`, `pnpm lint`, and `pnpm build`.

---

![build status](https://github.com/pajecawav/ghloc-web/actions/workflows/ci.yml/badge.svg)
[![lines count](https://img.shields.io/endpoint?url=https://ghloc.dev/api/pajecawav/ghloc-web/badge?filter=.ts$,.tsx$)](https://ghloc.dev/pajecawav/ghloc-web?filter=.ts$,.tsx$)
[![Firefox addon version](https://img.shields.io/amo/v/ghloc)](https://addons.mozilla.org/en-US/firefox/addon/ghloc/)

A [website](https://ghloc.dev/) to display GitHub repository info:

- Total repo size
- Repo health calculated by GitHub (`README.md`, license, etc)
- Repo commit activity for the past year
- Bundle size of an `npm` package
- Total lines of code by file extension (provided by [ghloc](https://github.com/subtle-byte/ghloc))

[![Screenshot](https://user-images.githubusercontent.com/18193831/199794714-a4c7d8c1-17c3-4be9-8de4-dc0fb745ea2d.png)](https://ghloc.dev/facebook/react)

## Addons

You can use a [user script](https://gist.github.com/pajecawav/70ffe72bf4aa0968aa9f97318976138f) to add a direct link to repo's ghloc page. Can be installed with [Tampermonkey](https://www.tampermonkey.net/).

Also [Firefox addon](https://addons.mozilla.org/en-US/firefox/addon/ghloc/) is available. It provides LOCs stats dropdown directly on project's GitHub page and a direct link to repo's ghloc page. Source code available [here](https://github.com/pajecawav/ghloc-extension/).

## Badges

You can use [shields.io](https://shields.io) to embed badges into your README. Navigate to the
[endpoint badge docs](https://shields.io/badges/endpoint-badge) and enter the following to the `url`
field:

```
https://ghloc.dev/api/OWNER/REPO/badge
```

Then you can preview your badge by clicking "Execute" and copy the full badge URL generated by shields.io which will look something like this:

```
https://img.shields.io/endpoint?url=https://ghloc.dev/api/OWNER/REPO/badge
```

<p align="center">
    <img src="https://github.com/pajecawav/ghloc-web/assets/18193831/b5057889-9499-4296-88f3-fe0b40150cbf">
</p>

You can also optionally add an optional `filter` search param. For example the badge at the top of
this README has the following URL and only counts files with `.ts` or `.tsx` extension:

```
https://img.shields.io/endpoint?url=https://ghloc.dev/api/pajecawav/ghloc-web/badge?filter=.ts$,.tsx$
```

To humanize LOC count you can add `format=human` to search params. So to a produce badge like [![lines
count](https://img.shields.io/endpoint?url=https://ghloc.dev/api/pajecawav/ghloc-web/badge?format=human)](https://ghloc.dev/pajecawav/ghloc-web)
you can use following URL:

```
https://img.shields.io/endpoint?url=https://ghloc.dev/api/pajecawav/ghloc-web/badge?format=human
```

## Development

You can start a dev server by running following commands:

```bash
git clone https://github.com/pajecawav/ghloc-web.git
cd ghloc-web
pnpm install
pnpm dev
```

Then navigate to [http://localhost:3000](http://localhost:3000)
