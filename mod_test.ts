import { assertEquals } from "@std/assert";
import type { GeneratedPage, SiteConfig } from "@steno/steno";
import createPlugin, {
  classifyHref,
  extractHrefs,
  findInternalLinkTargets,
  invertEdges,
  isInCollectionScope,
  normalizeSlug,
  resolveInternalTargetSlug,
  resolveRelativeSlug,
  stripCodeBlocks,
} from "./mod.ts";

function siteConfig(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    title: "Test site",
    description: "",
    author: "",
    output: "",
    ...overrides,
  };
}

function generatedPage(overrides: Partial<GeneratedPage> = {}): GeneratedPage {
  return {
    path: "",
    html: "",
    ...overrides,
  };
}

// --- extractHrefs -----------------------------------------------------

Deno.test("extractHrefs: reads double-quoted hrefs", () => {
  assertEquals(extractHrefs(`<a href="/about">About</a>`), ["/about"]);
});

Deno.test("extractHrefs: reads single-quoted hrefs", () => {
  assertEquals(extractHrefs(`<a href='/about'>About</a>`), ["/about"]);
});

Deno.test("extractHrefs: handles attributes before and after href", () => {
  const html = `<a class="link" href="/about" target="_blank">About</a>`;
  assertEquals(extractHrefs(html), ["/about"]);
});

Deno.test("extractHrefs: handles a self-closing-style anchor tag", () => {
  const html = `<a href="/about" />`;
  assertEquals(extractHrefs(html), ["/about"]);
});

Deno.test("extractHrefs: extracts multiple links in document order, duplicates included", () => {
  const html = `<a href="/a">A</a><p>x</p><a href="/b">B</a><a href="/a">A again</a>`;
  assertEquals(extractHrefs(html), ["/a", "/b", "/a"]);
});

Deno.test("extractHrefs: ignores non-anchor tags with href-like attributes", () => {
  const html = `<link rel="stylesheet" href="/style.css">`;
  assertEquals(extractHrefs(html), []);
});

Deno.test("extractHrefs: returns nothing for an anchor with no href (named anchor)", () => {
  assertEquals(extractHrefs(`<a name="top">Top</a>`), []);
});

// --- stripCodeBlocks ----------------------------------------------------

Deno.test("stripCodeBlocks: removes links inside <pre> blocks", () => {
  const html = `<pre><a href="/inside">x</a></pre><a href="/outside">y</a>`;
  assertEquals(extractHrefs(stripCodeBlocks(html)), ["/outside"]);
});

Deno.test("stripCodeBlocks: removes links inside <code> blocks", () => {
  const html = `<code><a href="/inside">x</a></code><a href="/outside">y</a>`;
  assertEquals(extractHrefs(stripCodeBlocks(html)), ["/outside"]);
});

Deno.test("stripCodeBlocks: leaves surrounding markup intact", () => {
  const html = `<p>before</p><pre>code</pre><p>after</p>`;
  assertEquals(stripCodeBlocks(html), `<p>before</p><p>after</p>`);
});

// --- classifyHref ---------------------------------------------------------

Deno.test("classifyHref: relative path is internal", () => {
  assertEquals(classifyHref("/about"), "internal");
  assertEquals(classifyHref("about.html"), "internal");
  assertEquals(classifyHref("../post-2/"), "internal");
});

Deno.test("classifyHref: fragment-only link is ignored", () => {
  assertEquals(classifyHref("#section"), "ignored");
});

Deno.test("classifyHref: empty href is ignored", () => {
  assertEquals(classifyHref(""), "ignored");
  assertEquals(classifyHref("   "), "ignored");
});

Deno.test("classifyHref: mailto and tel links are ignored", () => {
  assertEquals(classifyHref("mailto:hi@example.com"), "ignored");
  assertEquals(classifyHref("tel:+15555550100"), "ignored");
});

Deno.test("classifyHref: javascript and data links are ignored", () => {
  assertEquals(classifyHref("javascript:void(0)"), "ignored");
  assertEquals(classifyHref("data:text/plain,hi"), "ignored");
});

Deno.test("classifyHref: absolute link with no baseUrl configured is external", () => {
  assertEquals(classifyHref("https://example.com/about"), "external");
});

Deno.test("classifyHref: absolute link matching baseUrl host is internal", () => {
  assertEquals(classifyHref("https://example.com/about", "https://example.com"), "internal");
});

Deno.test("classifyHref: absolute link to a different host is external even with baseUrl set", () => {
  assertEquals(classifyHref("https://other.com/about", "https://example.com"), "external");
});

Deno.test("classifyHref: protocol-relative link matching baseUrl host is internal", () => {
  assertEquals(classifyHref("//example.com/about", "https://example.com"), "internal");
});

Deno.test("classifyHref: malformed absolute-looking href is external, not a throw", () => {
  assertEquals(classifyHref("https://", "https://example.com"), "external");
});

// --- normalizeSlug ----------------------------------------------------

Deno.test("normalizeSlug: strips leading slash", () => {
  assertEquals(normalizeSlug("/about"), "about");
});

Deno.test("normalizeSlug: strips query and fragment", () => {
  assertEquals(normalizeSlug("/about?x=1#y"), "about");
});

Deno.test("normalizeSlug: collapses trailing index.html", () => {
  assertEquals(normalizeSlug("/blog/post-1/index.html"), "blog/post-1");
});

Deno.test("normalizeSlug: root index.html normalizes to empty string", () => {
  assertEquals(normalizeSlug("/index.html"), "");
  assertEquals(normalizeSlug("index.html"), "");
});

Deno.test("normalizeSlug: strips a bare .html extension", () => {
  assertEquals(normalizeSlug("/about.html"), "about");
});

Deno.test("normalizeSlug: strips trailing slash", () => {
  assertEquals(normalizeSlug("/blog/post-1/"), "blog/post-1");
});

// --- resolveRelativeSlug / resolveInternalTargetSlug -----------------------

Deno.test("resolveRelativeSlug: resolves a sibling page", () => {
  assertEquals(resolveRelativeSlug("blog", "post-2.html"), "blog/post-2");
});

Deno.test("resolveRelativeSlug: resolves a parent-relative link", () => {
  assertEquals(resolveRelativeSlug("blog/post-1", "../post-2/"), "blog/post-2");
});

Deno.test("resolveInternalTargetSlug: root-relative href ignores sourceSlug", () => {
  assertEquals(resolveInternalTargetSlug("/about", "blog/post-1"), "about");
});

Deno.test("resolveInternalTargetSlug: page-relative href resolves against source directory", () => {
  assertEquals(resolveInternalTargetSlug("post-2.html", "blog/post-1"), "blog/post-2");
});

// --- findInternalLinkTargets --------------------------------------------

Deno.test("findInternalLinkTargets: collects and dedups internal targets, skips external/ignored", () => {
  const html = `
    <a href="/about">About</a>
    <a href="https://external.com/x">External</a>
    <a href="#top">Top</a>
    <a href="mailto:hi@example.com">Mail</a>
    <a href="/about">About again</a>
  `;
  assertEquals(findInternalLinkTargets(html, "index"), ["about"]);
});

Deno.test("findInternalLinkTargets: honors baseUrl for absolute self-links", () => {
  const html = `<a href="https://example.com/about">About</a>`;
  assertEquals(
    findInternalLinkTargets(html, "index", "https://example.com"),
    ["about"],
  );
});

// --- invertEdges ------------------------------------------------------

Deno.test("invertEdges: inverts source->target edges into target->backlinks", () => {
  const edges = [
    { source: "blog/post-1", target: "about" },
    { source: "blog/post-2", target: "about" },
  ];
  const pages = [
    { slug: "blog/post-1", title: "Post 1" },
    { slug: "blog/post-2", title: "Post 2" },
    { slug: "about", title: "About" },
  ];
  const result = invertEdges(edges, pages);
  assertEquals(result, {
    about: [
      { slug: "blog/post-1", title: "Post 1" },
      { slug: "blog/post-2", title: "Post 2" },
    ],
  });
});

Deno.test("invertEdges: falls back to slug as title when page metadata is missing", () => {
  const result = invertEdges([{ source: "blog/post-1", target: "about" }], []);
  assertEquals(result, { about: [{ slug: "blog/post-1", title: "blog/post-1" }] });
});

Deno.test("invertEdges: dedups a page linking to the same target twice", () => {
  const edges = [
    { source: "blog/post-1", target: "about" },
    { source: "blog/post-1", target: "about" },
  ];
  const result = invertEdges(edges, [{ slug: "blog/post-1", title: "Post 1" }]);
  assertEquals(result.about.length, 1);
});

Deno.test("invertEdges: excludes self-references by default", () => {
  const edges = [{ source: "about", target: "about" }];
  const result = invertEdges(edges, [{ slug: "about", title: "About" }]);
  assertEquals(result, {});
});

Deno.test("invertEdges: keeps self-references when excludeSelfReferences is false", () => {
  const edges = [{ source: "about", target: "about" }];
  const result = invertEdges(edges, [{ slug: "about", title: "About" }], {
    excludeSelfReferences: false,
  });
  assertEquals(result, { about: [{ slug: "about", title: "About" }] });
});

Deno.test("invertEdges: empty edge list produces an empty map", () => {
  assertEquals(invertEdges([], []), {});
});

// --- isInCollectionScope ------------------------------------------------

Deno.test("isInCollectionScope: a root-level page (no folder) is out of scope", () => {
  assertEquals(isInCollectionScope("about", undefined), false);
});

Deno.test("isInCollectionScope: any folder segment is in scope when collections aren't configured", () => {
  assertEquals(isInCollectionScope("blog/post-1", undefined), true);
});

Deno.test("isInCollectionScope: only configured collection names are in scope when collections are set", () => {
  assertEquals(isInCollectionScope("blog/post-1", { blog: {} }), true);
  assertEquals(isInCollectionScope("notes/todo", { blog: {} }), false);
});

// --- plugin wiring --------------------------------------------------------

Deno.test("plugin-backlinks: has a stable name", () => {
  const plugin = createPlugin();
  assertEquals(plugin.name, "plugin-backlinks");
});

Deno.test("plugin-backlinks: end-to-end afterPage + afterBuild writes _backlinks.json", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const plugin = createPlugin();
    const config = siteConfig({
      output: dir,
      pages: [
        { slug: "blog/post-1", title: "Post 1" },
        { slug: "blog/post-2", title: "Post 2" },
        { slug: "about", title: "About" },
      ],
    });

    await plugin.beforeBuild?.(config);
    await plugin.afterPage?.(
      generatedPage({
        path: `${dir}/blog/post-1/index.html`,
        html: `<a href="/about">About</a>`,
      }),
    );
    await plugin.afterPage?.(
      generatedPage({
        path: `${dir}/blog/post-2/index.html`,
        html: `<a href="/about">About</a><a href="/blog/post-1/">Post 1</a>`,
      }),
    );
    await plugin.afterPage?.(
      generatedPage({
        path: `${dir}/about/index.html`,
        html: `<a href="https://external.com">External</a>`,
      }),
    );
    await plugin.afterBuild?.(config);

    const written = JSON.parse(await Deno.readTextFile(`${dir}/_backlinks.json`));
    assertEquals(written.field, "backlinks");
    assertEquals(written.backlinks.about, [
      { slug: "blog/post-1", title: "Post 1" },
      { slug: "blog/post-2", title: "Post 2" },
    ]);
    assertEquals(written.backlinks["blog/post-1"], [{ slug: "blog/post-2", title: "Post 2" }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("plugin-backlinks: empty site (no pages) writes an empty backlinks map, no crash", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const plugin = createPlugin();
    const config = siteConfig({ output: dir, pages: [] });
    await plugin.beforeBuild?.(config);
    await plugin.afterBuild?.(config);

    const written = JSON.parse(await Deno.readTextFile(`${dir}/_backlinks.json`));
    assertEquals(written.backlinks, {});
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("plugin-backlinks: scope 'collections' skips scanning standalone pages", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const plugin = createPlugin({ scope: "collections" });
    const config = siteConfig({
      output: dir,
      pages: [
        { slug: "about", title: "About" },
        { slug: "blog/post-1", title: "Post 1" },
      ],
    });

    await plugin.beforeBuild?.(config);
    // Standalone page (no folder segment) — should be skipped as a source.
    await plugin.afterPage?.(
      generatedPage({ path: `${dir}/about/index.html`, html: `<a href="/blog/post-1">P1</a>` }),
    );
    // Collection page — should be scanned.
    await plugin.afterPage?.(
      generatedPage({
        path: `${dir}/blog/post-1/index.html`,
        html: `<a href="/about">About</a>`,
      }),
    );
    await plugin.afterBuild?.(config);

    const written = JSON.parse(await Deno.readTextFile(`${dir}/_backlinks.json`));
    // /about's outgoing link was never scanned, so blog/post-1 has no backlinks.
    assertEquals(written.backlinks["blog/post-1"], undefined);
    // blog/post-1's outgoing link to /about was scanned.
    assertEquals(written.backlinks.about, [{ slug: "blog/post-1", title: "Post 1" }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("plugin-backlinks: rejects when config.output is missing", async () => {
  const plugin = createPlugin();
  await plugin.beforeBuild?.(siteConfig({ output: undefined }));
  let threw = false;
  try {
    await plugin.afterBuild?.(siteConfig({ output: undefined }));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
