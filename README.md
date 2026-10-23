# redirect-map-generator

Build the 301 redirect map for a site migration from two sitemaps or URL lists. Every old URL is matched to its closest new one, problems are flagged before launch, and the map is written in your platform's format. A CLI and a small library with no dependencies.

**Prefer a browser?** The same matching runs at [dardo.studio/tools/redirect-map-generator](https://dardo.studio/tools/redirect-map-generator/), where you can review and edit each match before you export.

```sh
npx redirect-map-generator \
  --old https://www.old-site.com/sitemap.xml \
  --new https://staging.new-site.com/sitemap.xml \
  --format netlify --out _redirects
```

> Until the npm release is out, run it straight from GitHub: `npx github:nicoceron/redirect-map-generator …`


```
466 old URLs, 312 new URLs: 180 keep their address, 286 need a redirect.
Matched by slug 201, by similar words 52, to a parent section 33.
Check: 4 to the home page, 2 chains resolved, 0 loops, 0 duplicates, 0 targets not in the new list.
Wrote netlify to _redirects.
```

(Numbers are illustrative.)

## How it matches

For each old URL, in order:

1. **Same path**, ignoring case, trailing slashes, `index.html` and file extensions: no redirect needed.
2. **Same slug** (the last path segment) when exactly one new URL has it: `/blog/2021/05/my-post/` → `/blog/my-post/`.
3. **Similar words** in the path and slug (word overlap plus edit distance), above a threshold you can tune: `/services/web-design/` → `/services/website-design/`.
4. **The nearest parent section** the new site has, else its home page.

Then it checks the whole map: chains are followed to their final target, loops and duplicate sources are flagged, and so are redirects to the home page and targets missing from the new list. Review those rows before launch; a page sent to the home page is usually a page that needs a better match.

## Formats

| `--format` | Output |
|---|---|
| `csv` | old URL, new URL, match type, score, problems: for review in a spreadsheet |
| `netlify` | `_redirects` for Netlify and Cloudflare Pages (status written explicitly) |
| `cloudflare-bulk` | Cloudflare Bulk Redirects CSV |
| `apache` | `RedirectMatch` rules for `.htaccess` (exact paths, not prefixes) |
| `nginx` | `location = … { return 301 …; }` blocks |
| `vercel` | `vercel.json` redirects |
| `nextjs` | `redirects()` for `next.config.js` |
| `astro` | `redirects` for `astro.config.mjs` |
| `shopify` | Shopify URL redirect import CSV |

## CLI

```sh
redirect-map-generator --old <source> --new <source> [options]

  --format F        csv (default), netlify, cloudflare-bulk, apache, nginx, vercel, nextjs, astro, shopify
  --status N        301 (default) or 308
  --out FILE        Write to FILE ("auto" uses the format's usual file name); default: stdout
  --threshold N     Similarity needed for a "similar" match, 0–1 (default 0.45)
  --old-origin URL  The old site's origin, when the old list has only paths
  --new-origin URL  The new site's origin, when the domain changes
```

A source is a sitemap or sitemap index URL (child sitemaps are followed, gzip is fine), or a local sitemap, a CSV/TSV crawl export (Screaming Frog and similar: the first cell that looks like a URL is used) or a text file with one URL or path per line.

## Library

```js
import { loadUrls, buildMap, writeMap } from "redirect-map-generator";

const [oldUrls, newUrls] = await Promise.all([
  loadUrls("https://www.old-site.com/sitemap.xml"),
  loadUrls("./new-urls.txt"),
]);
const map = buildMap(oldUrls, newUrls);          // { rows: [{ from, to, match, score, problems }], ... }
const nginx = writeMap(map, "nginx", 301);
```

The lower-level pieces (`matchPaths`, `checkRows`, `exportMap`, `parseList`, `pathOf`) are exported too.

## About

Built and maintained by [Dardo](https://dardo.studio), a web design and development studio in Bogotá that works with teams in the US and Latin America. We use it on our own [website migrations](https://dardo.studio/services/website-migration/) and opened it up so a redirect map can live in your repository and your CI.

MIT licensed. Issues and pull requests are welcome.
