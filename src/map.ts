// The redirect map builder's matching and exports: old URLs against new ones,
// each old path matched to its closest new path (same path, same slug, similar
// words, else its nearest parent), problems flagged, and the map written in
// each server's or platform's format. Pure functions, the same rules as the
// browser version at https://dardo.studio/tools/redirect-map-generator/

export type Match = "same" | "slug" | "similar" | "parent" | "manual";
export type Row = { from: string; to: string; match: Match; score: number };
export type Problem = "chain" | "loop" | "home" | "duplicate" | "not-new";
export type Checked = Row & { problems: Problem[] };

/** A URL or path as the path (and query) a redirect matches: no origin, no fragment. */
export function pathOf(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, "https://example.invalid");
    if (!/^https?:$/.test(url.protocol)) return "";
    let pathname = url.pathname.replace(/\/{2,}/g, "/");
    try { pathname = decodeURI(pathname); } catch { /* keep it encoded */ }
    return `${pathname}${url.search}`;
  } catch {
    return "";
  }
}

/** The host a list's absolute URLs share, if any. */
export function hostOf(lines: string[]): string {
  const hosts = new Set(lines.flatMap((line) => {
    try { return /^https?:\/\//i.test(line.trim()) ? [new URL(line.trim()).host] : []; } catch { return []; }
  }));
  return hosts.size === 1 ? [...hosts][0] : "";
}

/** The URLs in pasted text, a sitemap or a crawl export (CSV or TSV: the first cell that looks like a URL or path). */
export function parseList(text: string): string[] {
  if (/<(urlset|sitemapindex)[\s>]/i.test(text)) {
    return [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&").trim());
  }
  return text.split(/\r?\n/).flatMap((line) => {
    const cells = line.split(/[\t,;]/).map((cell) => cell.trim().replace(/^["']|["']$/g, ""));
    const cell = cells.find((c) => /^https?:\/\//i.test(c) || c.startsWith("/"));
    return cell ? [cell] : [];
  });
}

// The key two paths match on: lower case, no trailing slash, no index file or extension, no query.
const key = (path: string) => {
  const bare = path.split("?")[0].toLowerCase().replace(/\/index\.(html?|php|aspx?)$/, "/").replace(/\.(html?|php|aspx?)$/, "");
  return bare.length > 1 ? bare.replace(/\/+$/, "") : "/";
};
const slugOf = (path: string) => key(path).split("/").filter(Boolean).at(-1) ?? "";
const words = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9À-ɏ]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w)));

/** Levenshtein similarity, 0–1. */
export function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
};

/** Each old path's closest new path. */
export function matchPaths(oldPaths: string[], newPaths: string[], threshold = 0.45): Row[] {
  const targets = [...new Set(newPaths.filter(Boolean))];
  const byKey = new Map(targets.map((path) => [key(path), path]));
  const bySlug = new Map<string, string[]>();
  for (const path of targets) {
    const slug = slugOf(path);
    if (slug) bySlug.set(slug, [...(bySlug.get(slug) ?? []), path]);
  }
  const prepared = targets.map((path) => ({ path, slug: slugOf(path), words: words(key(path)) }));
  return [...new Set(oldPaths.filter(Boolean))].map((from): Row => {
    const same = byKey.get(key(from));
    if (same) return { from, to: same, match: "same", score: 1 };
    const slug = slugOf(from);
    const slugMatches = slug ? bySlug.get(slug) ?? [] : [];
    if (slugMatches.length === 1) return { from, to: slugMatches[0], match: "slug", score: 0.95 };
    const fromWords = words(key(from));
    let best = { path: "", score: 0 };
    for (const target of prepared) {
      if (target.path === "/") continue;
      const score = 0.6 * overlap(fromWords, target.words) + 0.4 * similarity(slug, target.slug);
      if (score > best.score) best = { path: target.path, score };
    }
    if (best.score >= threshold) return { from, to: best.path, match: "similar", score: Math.round(best.score * 100) / 100 };
    // No close page: the nearest parent section the new site has, else its home page.
    const segments = key(from).split("/").filter(Boolean);
    for (let i = segments.length - 1; i > 0; i--) {
      const parent = byKey.get(`/${segments.slice(0, i).join("/")}`);
      if (parent) return { from, to: parent, match: "parent", score: 0.2 };
    }
    return { from, to: byKey.get("/") ?? "/", match: "parent", score: 0.1 };
  });
}

/** The rows that need a redirect, each with its problems: chains and loops resolved to their end where possible. */
export function checkRows(rows: Row[], newPaths: string[]): Checked[] {
  const newKeys = new Set(newPaths.map(key));
  const redirects = rows.filter((row) => key(row.from) !== key(row.to) || row.from !== row.to);
  const sourceTarget = new Map(redirects.map((row) => [key(row.from), row.to]));
  const seen = new Map<string, number>();
  for (const row of redirects) seen.set(key(row.from), (seen.get(key(row.from)) ?? 0) + 1);
  return redirects.map((row) => {
    const problems: Problem[] = [];
    // Follow the target through other redirects in the map.
    let to = row.to;
    const visited = new Set([key(row.from)]);
    while (sourceTarget.has(key(to)) && key(sourceTarget.get(key(to))!) !== key(to)) {
      if (visited.has(key(to))) { problems.push("loop"); break; }
      visited.add(key(to));
      to = sourceTarget.get(key(to))!;
      if (!problems.includes("chain")) problems.push("chain");
    }
    if (key(to) === key(row.from)) problems.push("loop");
    if (key(to) === "/" && key(row.from) !== "/") problems.push("home");
    if ((seen.get(key(row.from)) ?? 0) > 1) problems.push("duplicate");
    if (newPaths.length && !newKeys.has(key(to))) problems.push("not-new");
    return { ...row, to: problems.includes("loop") ? row.to : to, problems: [...new Set(problems)] };
  });
}

export type Format = "csv" | "netlify" | "cloudflare-bulk" | "apache" | "nginx" | "vercel" | "nextjs" | "astro" | "shopify";
export const formats: Format[] = ["csv", "netlify", "cloudflare-bulk", "apache", "nginx", "vercel", "nextjs", "astro", "shopify"];
const files: Record<Format, string> = {
  csv: "redirect-map.csv", netlify: "_redirects", "cloudflare-bulk": "cloudflare-bulk-redirects.csv", apache: "redirects.htaccess",
  nginx: "redirects.nginx.conf", vercel: "vercel.json", nextjs: "next.config.redirects.js", astro: "astro.config.redirects.mjs", shopify: "shopify-redirects.csv",
};
export const fileFor = (format: Format) => files[format];

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
const encode = (path: string) => encodeURI(path).replace(/%25([0-9a-f]{2})/gi, "%$1");

/**
 * The map in one format. `newOrigin` ("https://www.example.com") makes targets
 * absolute where the format needs it (Cloudflare Bulk Redirects) or when the
 * domain changes; `oldOrigin` is the site the old paths belong to.
 */
export function exportMap(rows: Checked[], format: Format, options: { status: 301 | 308; oldOrigin: string; newOrigin: string }): string {
  const { status, oldOrigin, newOrigin } = options;
  const target = (path: string) => (newOrigin && newOrigin !== oldOrigin ? `${newOrigin}${encode(path)}` : encode(path));
  const pathOnly = (path: string) => encode(path.split("?")[0]);
  // Vercel and Next.js: `permanent` is a 308; a 301 is asked for by its status code.
  const vercelStatus = () => (status === 308 ? { permanent: true } : { statusCode: 301 });
  // Apache: RedirectMatch on the exact path (Redirect would also catch every path under it).
  const exact = (path: string) => `^${pathOnly(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\/$/, "")}/?$`;
  switch (format) {
    case "csv":
      return ["old_url,new_url,match,score,problems", ...rows.map((r) => [r.from, r.to, r.match, String(r.score), r.problems.join(" ")].map(csvCell).join(","))].join("\n") + "\n";
    case "netlify":
      // Netlify and Cloudflare Pages: one rule per line, the status explicit (Cloudflare Pages defaults to 302).
      return rows.map((r) => `${pathOnly(r.from)} ${target(r.to)} ${status}`).join("\n") + "\n";
    case "cloudflare-bulk": {
      // Cloudflare Bulk Redirects CSV: no header row; source without scheme, absolute target, status.
      const host = (oldOrigin || "https://example.com").replace(/^https?:\/\//, "");
      const destination = newOrigin || oldOrigin || "https://example.com";
      return rows.map((r) => [`${host}${pathOnly(r.from)}`, `${destination}${encode(r.to)}`, String(status)].map(csvCell).join(",")).join("\n") + "\n";
    }
    case "apache":
      return ["# mod_alias: put these before other rewrite rules", ...rows.map((r) => `RedirectMatch ${status} ${exact(r.from)} ${target(r.to)}`)].join("\n") + "\n";
    case "nginx":
      return ["# inside the server { } block", ...rows.map((r) => `location = ${pathOnly(r.from)} { return ${status} ${target(r.to)}; }`)].join("\n") + "\n";
    case "vercel":
      return JSON.stringify({ redirects: rows.map((r) => ({ source: pathOnly(r.from), destination: target(r.to), ...vercelStatus() })) }, null, 2) + "\n";
    case "nextjs":
      return `// next.config.js\nmodule.exports = {\n  async redirects() {\n    return ${JSON.stringify(rows.map((r) => ({ source: pathOnly(r.from), destination: target(r.to), ...vercelStatus() })), null, 2).replace(/\n/g, "\n    ")};\n  },\n};\n`;
    case "astro":
      return `// astro.config.mjs\nexport default defineConfig({\n  redirects: ${JSON.stringify(Object.fromEntries(rows.map((r) => [pathOnly(r.from), status === 301 ? target(r.to) : { status, destination: target(r.to) }])), null, 2).replace(/\n/g, "\n  ")},\n});\n`;
    case "shopify":
      return ["Redirect from,Redirect to", ...rows.map((r) => [pathOnly(r.from), target(r.to)].map(csvCell).join(","))].join("\n") + "\n";
  }
}
