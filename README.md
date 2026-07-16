# @javinfo/mcp

An MCP server (stdio) for the [javinfo](https://javinfo.dev) API. Look up JAV
releases by DVD code, title, or actress, and get metadata, download links, or
stream URLs back.

## Tools

| Tool | Does |
|------|------|
| `javinfo-search` | Search by code, title, or actress — with optional filter, sort, and pagination. Returns a list of matches. |
| `javinfo-movie` | Fetch one release by exact DVD id. |
| `javinfo-random` | A batch of random DMM+FANZA titles (full records). |

Search first to find the code, then call `javinfo-movie` with it.

`providers` picks where the data comes from:

- `fanza`, `dmm` — metadata (also do free-text search)
- `javdb` — download links and magnets (`javinfo-movie` only)
- `missav` — `.m3u8` streams
- `javdatabase` — description and sample images

Movie output skips image URLs unless you pass `includeImages: true`. Every
result also carries the raw record as `structuredContent`.

### Filtering search

`javinfo-search` also takes `filter`, `sort`, `page`, and `num` (page size,
default 10, max 50). `q` is optional when a `filter` is set — browse a whole
category with no keyword.

`filter` fields (all optional): `genre`, `actress`, `maker`, `series`,
`director`, `label`, `actor`, `censored` (`censored`/`uncensored`), `runtimeMin`,
`runtimeMax` (minutes), `releaseAfter`, `releaseBefore` (`YYYY-MM-DD`),
`availability` (`playable`/`magnets`/`subtitle`/`single`). `sort` is one of
`relevance` (default), `release`, `update`, `rating`.

Not every provider supports every filter — e.g. runtime range is fanza/dmm/missav,
release range and Japanese genres are missav, `availability` is javdb. Values
pass through **verbatim** (exact match; English vs Japanese genres vary by
source). Unpinned, the API skips a provider that can't satisfy a filter and
tries the next; **pin** a provider that can't and you get a `422` with the
reason.

## Setup

Needs a javinfo API key in the `JAVINFO_API_KEY` environment variable.
Get your free key at [javinfo.dev](https://javinfo.dev).

```json
{
  "mcpServers": {
    "javinfo": {
      "command": "npx",
      "args": ["-y", "@javinfo/mcp"],
      "env": { "JAVINFO_API_KEY": "jvi_..." }
    }
  }
}
```

## Local

```bash
npm install
npm run build
npm test   # formatter checks
JAVINFO_API_KEY=jvi_... npx @modelcontextprotocol/inspector node dist/index.js
```
