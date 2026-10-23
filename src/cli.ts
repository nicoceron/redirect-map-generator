#!/usr/bin/env node
// redirect-map-generator --old <sitemap URL or file> --new <sitemap URL or file> [--format F] [--status 301|308] [--out FILE]
import { writeFile } from "node:fs/promises";
import { buildMap, fileFor, formats, loadUrls, writeMap, type Format } from "./index.js";

const HELP = `Usage: redirect-map-generator --old <source> --new <source> [options]

Matches every old URL to its closest new URL (same path, same slug, similar
words, else the nearest parent section), flags chains, loops, duplicates and
redirects to the home page, and writes the map in your platform's format.

A source is a sitemap or sitemap index URL, or a local sitemap, CSV/TSV crawl
export or text file with one URL or path per line.

Options:
  --format F       ${formats.join(", ")} (default csv)
  --status N       301 or 308 (default 301)
  --out FILE       Write to FILE ("auto" uses the format's usual file name); default: stdout
  --threshold N    Similarity needed for a "similar" match, 0-1 (default 0.45)
  --old-origin URL The old site's origin, when the old list has only paths
  --new-origin URL The new site's origin, when the domain changes
  -h, --help       Show this help

Browser version: https://dardo.studio/tools/redirect-map-generator/`;

const args = process.argv.slice(2);
const get = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes("-h") || args.includes("--help") || !get("--old") || !get("--new")) {
  console.log(HELP);
  process.exit(args.includes("-h") || args.includes("--help") ? 0 : 2);
}

const format = (get("--format") ?? "csv") as Format;
if (!formats.includes(format)) {
  console.error(`Unknown format "${format}". Use one of: ${formats.join(", ")}`);
  process.exit(2);
}
const status = get("--status") === "308" ? 308 : 301;
const threshold = get("--threshold") ? Number(get("--threshold")) : undefined;

try {
  const [oldUrls, newUrls] = await Promise.all([loadUrls(get("--old")!), loadUrls(get("--new")!)]);
  if (!oldUrls.length || !newUrls.length) throw new Error(`no URLs found in ${!oldUrls.length ? "--old" : "--new"}`);
  const result = buildMap(oldUrls, newUrls, { threshold, oldOrigin: get("--old-origin"), newOrigin: get("--new-origin") });
  const output = writeMap(result, format, status);
  const out = get("--out") === "auto" ? fileFor(format) : get("--out");
  if (out) await writeFile(out, output);
  else process.stdout.write(output);

  const count = (match: string) => result.rows.filter((r) => r.match === match).length;
  const problems = (p: string) => result.rows.filter((r) => r.problems.includes(p as never)).length;
  const lines = [
    `${oldUrls.length} old URLs, ${newUrls.length} new URLs: ${result.unchanged} keep their address, ${result.rows.length} need a redirect.`,
    `Matched by slug ${count("slug")}, by similar words ${count("similar")}, to a parent section ${count("parent")}${count("same") ? `, same path ${count("same")}` : ""}.`,
    `Check: ${problems("home")} to the home page, ${problems("chain")} chains resolved, ${problems("loop")} loops, ${problems("duplicate")} duplicates, ${problems("not-new")} targets not in the new list.`,
    ...(out ? [`Wrote ${format} to ${out}.`] : []),
  ];
  console.error(lines.join("\n"));
} catch (error) {
  console.error(`redirect-map-generator: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
