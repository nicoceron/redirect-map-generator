// Loading URL lists (a sitemap URL, a sitemap index, a local sitemap, CSV or
// text file) and building a checked redirect map from two of them.
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { checkRows, exportMap, hostOf, matchPaths, parseList, pathOf, type Checked, type Format } from "./map.js";

export * from "./map.js";

const USER_AGENT = "redirect-map-generator (+https://github.com/nicoceron/redirect-map-generator)";

async function fetchBody(url: string, timeoutMs: number) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8");
}

/**
 * The URLs a source lists. A source is a URL (a sitemap or sitemap index,
 * followed up to `maxSitemaps` child sitemaps) or a local file (a sitemap,
 * a crawl export in CSV or TSV, or one URL or path per line).
 */
export async function loadUrls(source: string, options: { maxSitemaps?: number; maxUrls?: number; timeoutMs?: number } = {}): Promise<string[]> {
  const { maxSitemaps = 50, maxUrls = 50000, timeoutMs = 20000 } = options;
  if (!/^https?:\/\//i.test(source)) {
    const bytes = await readFile(source);
    return parseList((bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8")).slice(0, maxUrls);
  }
  const urls: string[] = [];
  const queue = [source];
  const seen = new Set<string>();
  while (queue.length && seen.size < maxSitemaps && urls.length < maxUrls) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const text = await fetchBody(next, timeoutMs);
    const locs = parseList(text);
    // A sitemap index lists more sitemaps; a sitemap lists pages.
    if (/<sitemapindex[\s>]/i.test(text)) queue.push(...locs);
    else urls.push(...locs);
  }
  return [...new Set(urls)].slice(0, maxUrls);
}

export type MapResult = { rows: Checked[]; unchanged: number; oldOrigin: string; newOrigin: string };

/** Matches every old URL to its closest new one and returns the redirects that need writing, each with its problems. */
export function buildMap(oldUrls: string[], newUrls: string[], options: { threshold?: number; oldOrigin?: string; newOrigin?: string } = {}): MapResult {
  const oldPaths = oldUrls.map(pathOf).filter(Boolean);
  const newPaths = newUrls.map(pathOf).filter(Boolean);
  const matched = matchPaths(oldPaths, newPaths, options.threshold);
  const rows = checkRows(matched, newPaths);
  const origin = (lines: string[]) => {
    const host = hostOf(lines);
    if (!host) return "";
    const scheme = lines.find((l) => /^https?:\/\//i.test(l.trim()))?.trim().match(/^https?/i)?.[0].toLowerCase() ?? "https";
    return `${scheme}://${host}`;
  };
  return {
    rows,
    unchanged: matched.length - rows.length,
    oldOrigin: options.oldOrigin ?? origin(oldUrls),
    newOrigin: options.newOrigin ?? origin(newUrls),
  };
}

/** A built map written in one format (see `formats`). */
export function writeMap(result: MapResult, format: Format, status: 301 | 308 = 301) {
  return exportMap(result.rows, format, { status, oldOrigin: result.oldOrigin, newOrigin: result.newOrigin });
}
