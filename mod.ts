import type { GeneratedPage, SiteConfig, StenoPlugin } from "@steno/steno";

/** Options accepted by this plugin. */
export interface PluginBacklinksOptions {
  /**
   * Frontmatter-shaped key the computed backlink index is meant to be
   * exposed under in page context once a theme or a second plugin reads
   * `_backlinks.json` back in. This plugin does not itself inject anything
   * into page context — see the README's "Scope" section — so this option
   * only travels along as metadata inside the written JSON file, for
   * whatever reads it next to know what key to mount it under.
   */
  field?: string;
  /**
   * `"all"` (default) scans every page's outgoing links. `"collections"`
   * only scans pages whose slug falls under a folder Steno auto-detects (or
   * explicitly configures) as a collection, skipping standalone pages like
   * `/404` or `/about`. See the README for exactly how membership is
   * decided. Scope only limits which pages are scanned as link *sources* —
   * an out-of-scope page can still receive backlinks from an in-scope one.
   */
  scope?: "all" | "collections";
  /** Drops a page linking to itself from its own backlink list. Default `true`. */
  excludeSelfReferences?: boolean;
  /**
   * The site's own origin (e.g. `"https://example.com"`), used to recognize
   * an absolute `<a href>` that actually points back at this site as an
   * internal link. `SiteConfig` has no built-in notion of a site URL, so
   * without this option only relative hrefs are ever treated as internal —
   * see the README's "Spec deviations" section.
   */
  baseUrl?: string;
  /** Output filename written under `config.output`. Default `"_backlinks.json"`. */
  outputFile?: string;
}

/** One recorded `source page → target page` internal link. */
export interface BacklinkEdge {
  source: string;
  target: string;
}

/** One entry in a target page's computed backlink list. */
export interface BacklinkEntry {
  slug: string;
  title: string;
}

const IGNORED_HREF_PREFIXES = ["mailto:", "tel:", "javascript:", "data:"];

/**
 * Removes `<pre>...</pre>` and `<code>...</code>` block contents from `html`
 * (replaced with an equal-ish blank stand-in, not collapsed away) so links
 * that appear inside code samples — e.g. a rendered Markdown snippet showing
 * `<a href="...">` as literal text, or a syntax highlighter that itself
 * wraps tokens in anchors — never get scanned as real navigation. This is a
 * deliberate scope choice; see the README.
 */
export function stripCodeBlocks(html: string): string {
  return html.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
}

/**
 * Extracts every `href` value from `<a ...>` tags in `html`, in document
 * order, duplicates included. Handles single- or double-quoted attribute
 * values, attributes in any order within the tag, and both self-closing and
 * ordinary `<a>` tags. Does not use a DOM parser — this is a plain regex
 * scan, which is enough for the well-formed HTML Steno's own renderer emits.
 */
export function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const tagPattern = /<a\b[^>]*>/gi;
  const hrefPattern = /\bhref\s*=\s*(["'])(.*?)\1/i;

  for (const tagMatch of html.matchAll(tagPattern)) {
    const hrefMatch = hrefPattern.exec(tagMatch[0]);
    if (hrefMatch) hrefs.push(hrefMatch[2]);
  }

  return hrefs;
}

/** What {@link classifyHref} decided about one `href` value. */
export type HrefClass = "internal" | "external" | "ignored";

/**
 * Classifies a raw `href` value as `"internal"` (relative, or absolute with
 * a host matching `baseUrl`), `"external"` (absolute, different host), or
 * `"ignored"` (empty, a fragment-only same-page anchor, or a non-navigation
 * scheme like `mailto:`/`tel:`/`javascript:`/`data:`).
 */
export function classifyHref(href: string, baseUrl?: string): HrefClass {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return "ignored";

  const lower = trimmed.toLowerCase();
  if (IGNORED_HREF_PREFIXES.some((prefix) => lower.startsWith(prefix))) return "ignored";

  if (trimmed.startsWith("//")) {
    return classifyHref(`https:${trimmed}`, baseUrl);
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (!baseUrl) return "external";
    try {
      const targetHost = new URL(trimmed).host;
      const siteHost = new URL(baseUrl).host;
      return targetHost === siteHost ? "internal" : "external";
    } catch {
      return "external";
    }
  }

  return "internal";
}

/**
 * Normalizes a slug or link path to a canonical, comparable form: strips
 * any query string or fragment, strips a leading `/`, collapses a trailing
 * `index.html`/`index.htm` (with its preceding slash) to nothing, strips a
 * bare `.html`/`.htm` extension otherwise, and strips a trailing `/`. Safe
 * to run on both a `config.pages[].slug` value and a link's path — however
 * `shortUrls` is configured, both end up at the same key. The site root
 * normalizes to `""`.
 */
export function normalizeSlug(raw: string): string {
  let value = raw.split("#")[0].split("?")[0];
  value = value.replace(/^\/+/, "");

  if (value === "index.html" || value === "index.htm") {
    value = "";
  } else if (value.endsWith("/index.html")) {
    value = value.slice(0, -"/index.html".length);
  } else if (value.endsWith("/index.htm")) {
    value = value.slice(0, -"/index.htm".length);
  } else if (value.endsWith(".html")) {
    value = value.slice(0, -".html".length);
  } else if (value.endsWith(".htm")) {
    value = value.slice(0, -".htm".length);
  }

  return value.replace(/\/+$/, "");
}

/**
 * Resolves a page-relative link path (one that doesn't start with `/`)
 * against the directory of the linking page's own (already-normalized)
 * slug, handling `.` and `..` segments. `baseDir` is a normalized slug's
 * directory portion (e.g. `"blog"` for the page `"blog/post-1"`).
 */
export function resolveRelativeSlug(baseDir: string, hrefPath: string): string {
  const stack = baseDir === "" ? [] : baseDir.split("/");
  for (const segment of hrefPath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return normalizeSlug(stack.join("/"));
}

/**
 * Resolves one raw internal `href` (already classified `"internal"`) to the
 * normalized target slug it points at, relative to `sourceSlug`.
 */
export function resolveInternalTargetSlug(href: string, sourceSlug: string): string {
  let pathOnly = href.split("#")[0].split("?")[0];

  if (pathOnly.startsWith("//")) pathOnly = `https:${pathOnly}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOnly)) {
    try {
      pathOnly = new URL(pathOnly).pathname;
    } catch {
      // fall through and treat as a literal path
    }
  }

  if (pathOnly.startsWith("/")) return normalizeSlug(pathOnly);

  const lastSlash = sourceSlug.lastIndexOf("/");
  const baseDir = lastSlash === -1 ? "" : sourceSlug.slice(0, lastSlash);
  return resolveRelativeSlug(baseDir, pathOnly);
}

/**
 * Scans one page's rendered HTML for internal links and returns the
 * (deduplicated) set of target slugs it points at.
 */
export function findInternalLinkTargets(
  html: string,
  sourceSlug: string,
  baseUrl?: string,
): string[] {
  const scanned = stripCodeBlocks(html);
  const targets = new Set<string>();

  for (const href of extractHrefs(scanned)) {
    if (classifyHref(href, baseUrl) !== "internal") continue;
    targets.add(resolveInternalTargetSlug(href, sourceSlug));
  }

  return [...targets];
}

/**
 * Inverts a list of `source → target` edges into a `target → backlinks[]`
 * map, using `pages` to resolve each source slug's title. A source slug
 * with no matching `pages` entry falls back to the slug itself as its
 * title. Backlinks are deduplicated by source slug and sorted for stable
 * output; a page linking to the same target from multiple links only
 * produces one entry.
 */
export function invertEdges(
  edges: BacklinkEdge[],
  pages: Array<{ slug: string; title?: string }>,
  options: { excludeSelfReferences?: boolean } = {},
): Record<string, BacklinkEntry[]> {
  const excludeSelfReferences = options.excludeSelfReferences ?? true;
  const titleBySlug = new Map(pages.map((page) => [page.slug, page.title]));

  const bySlugPerTarget = new Map<string, Map<string, BacklinkEntry>>();

  for (const { source, target } of edges) {
    if (excludeSelfReferences && source === target) continue;

    let bucket = bySlugPerTarget.get(target);
    if (!bucket) {
      bucket = new Map();
      bySlugPerTarget.set(target, bucket);
    }
    bucket.set(source, { slug: source, title: titleBySlug.get(source) || source });
  }

  const result: Record<string, BacklinkEntry[]> = {};
  for (const [target, bucket] of bySlugPerTarget) {
    result[target] = [...bucket.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }
  return result;
}

/**
 * Decides whether `slug` is in scope for `"collections"` scope: its first
 * path segment must either name a key in `config.collections` (when any are
 * explicitly configured) or, when none are configured, simply exist — i.e.
 * the slug has a folder segment at all, matching Steno's own auto-detection
 * of a collection from any `content/<folder>/` subdirectory. See the
 * README's "Scope" section for the full rationale.
 */
export function isInCollectionScope(
  slug: string,
  collections: Record<string, unknown> | undefined,
): boolean {
  const firstSegment = slug.split("/")[0];
  if (firstSegment === "" || firstSegment === slug) return false; // no folder segment

  if (collections && Object.keys(collections).length > 0) {
    return firstSegment in collections;
  }
  return true;
}

function relativeStagingSlug(fullPath: string, stagingRoot: string | undefined): string {
  const posixPath = fullPath.replaceAll("\\", "/");
  if (stagingRoot) {
    const posixRoot = stagingRoot.replaceAll("\\", "/").replace(/\/+$/, "");
    if (posixPath.startsWith(posixRoot + "/")) {
      return normalizeSlug(posixPath.slice(posixRoot.length + 1));
    }
    if (posixPath === posixRoot) return "";
  }
  return normalizeSlug(posixPath);
}

/**
 * Creates the plugin-backlinks plugin.
 *
 * Registered in a site's config.yml:
 *
 * ```yaml
 * plugins:
 *   - package: jsr:@you/plugin-backlinks
 *     options:
 *       field: backlinks
 *       scope: all
 * ```
 */
export default function pluginBacklinks(options: PluginBacklinksOptions = {}): StenoPlugin {
  const field = options.field ?? "backlinks";
  const scope = options.scope ?? "all";
  const excludeSelfReferences = options.excludeSelfReferences ?? true;
  const outputFile = options.outputFile ?? "_backlinks.json";

  let stagingRoot: string | undefined;
  let collections: Record<string, unknown> | undefined;
  const edges: BacklinkEdge[] = [];

  return {
    name: "plugin-backlinks",

    beforeBuild(config) {
      stagingRoot = config.output;
      collections = config.collections;
      edges.length = 0;
    },

    afterPage(page: GeneratedPage) {
      const sourceSlug = relativeStagingSlug(page.path, stagingRoot);

      if (scope === "collections" && !isInCollectionScope(sourceSlug, collections)) {
        return;
      }

      for (const target of findInternalLinkTargets(page.html, sourceSlug, options.baseUrl)) {
        edges.push({ source: sourceSlug, target });
      }
    },

    async afterBuild(config: SiteConfig) {
      if (!config.output) {
        throw new Error(
          "plugin-backlinks: config.output is missing, cannot write _backlinks.json.",
        );
      }

      const pages = config.pages ?? [];
      const normalizedPages = pages.map((page) => ({
        slug: normalizeSlug(page.slug),
        title: page.title,
      }));

      const backlinks = invertEdges(edges, normalizedPages, { excludeSelfReferences });

      const index = { field, backlinks };
      await Deno.writeTextFile(`${config.output}/${outputFile}`, JSON.stringify(index, null, 2));
    },
  };
}
