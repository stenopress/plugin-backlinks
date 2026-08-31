# @steno/plugin-backlinks

Backlinks plugin for [Steno](https://github.com/steno/steno) that computes a reverse internal-link
graph - "what other pages on this site link to this one" - and writes it as a JSON index.

This is for a site that wants a "Read also" / "Linked from" section on each page without hand-tracking
which pages reference which. Steno has no built-in equivalent: nothing in `PageRenderContext` tracks
inbound links, so without this plugin every page would need to know its own backlinks in advance,
which defeats the purpose.

## Installation

```yaml
# content/.steno/config.yml
plugins:
  - jsr:@steno/plugin-backlinks
```

## Options

```yaml
plugins:
  - package: jsr:@steno/plugin-backlinks
    options:
      field: backlinks
      scope: all
      excludeSelfReferences: true
      baseUrl: https://example.com
```

| Option                  | Type                     | Default             | Description                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `field`                 | `string`                 | `"backlinks"`        | Frontmatter-shaped key the computed index is meant to be exposed under in page context once something reads `_backlinks.json` back in. Carried into the written JSON as metadata only - see "Consuming the JSON index" below.                                                                                                       |
| `scope`                 | `"all" \| "collections"` | `"all"`               | `"collections"` only *scans* pages that belong to a collection folder, skipping standalone pages like `/404` or `/about` as link sources. An out-of-scope page can still receive backlinks from an in-scope one - scope only limits which pages' outgoing links get scanned.                                                        |
| `excludeSelfReferences` | `boolean`                | `true`                | Drops a page linking to itself (e.g. via an anchor link) from its own backlink list.                                                                                                                                                                                                                                                  |
| `baseUrl`               | `string`                 | `undefined`           | The site's own origin (e.g. `"https://example.com"`), used to recognize an absolute `<a href>` that actually points back at this site. Without it, only relative hrefs count as internal.                                                                                                                                            |
| `outputFile`            | `string`                 | `"_backlinks.json"`   | Output filename written directly under `config.output`.                                                                                                                                                                                                                                                                               |

## How it works

The plugin runs in two passes:

1. `afterPage`: for each generated page, scans its already-rendered `page.html` (handed to the hook
   directly - no disk read needed) for every `<a href="...">`, classifies each as internal or not,
   resolves internal ones to a normalized target slug, and records a `sourceSlug → targetSlug` edge.
   The source slug itself is derived from `page.path` (the writable staging path) relative to
   `config.output` as captured in `beforeBuild` - both are staging-rooted, per
   [atomic_builds.md](https://github.com/stenopress/steno/blob/main/docs/atomic_builds.md), so this
   never touches `finalPath` or reads a file back off disk.
2. `afterBuild`: once every page has been seen, inverts the edge list into
   `targetSlug → [{slug, title}, ...]` (deduplicated, self-references dropped by default) and writes
   it to `<output>/_backlinks.json`.

Backlinks are therefore only accurate as of the previous build - computing the whole content graph
in a single pass before rendering starts isn't possible from the plugin surface alone, since
`afterPage`/`afterBuild` hooks only see already-rendered HTML. `steno dev` picks up the previous
build's index immediately, so in practice this only shows up as "a backlink appears one save later,"
not as a persistent staleness.

### Link extraction rules

Links are found with a plain regex scan over each page's rendered HTML - no DOM parser dependency.

- Both `href="..."` and `href='...'` are recognized, in any attribute order within the `<a>` tag, on
  both self-closing-style and ordinary tags.
- `<pre>...</pre>` and `<code>...</code>` block contents are stripped before scanning, so a link that
  only appears inside a code sample is never counted as real navigation.
- An href is **ignored** entirely when it's empty, a same-page fragment-only anchor (`#section`), or
  uses a non-navigation scheme: `mailto:`, `tel:`, `javascript:`, `data:`.
- An href is **internal** when it's relative (root-relative like `/about`, or page-relative like
  `post-2.html` / `../post-2/`), or absolute/protocol-relative with a host matching `baseUrl`.
  Page-relative hrefs are resolved against the linking page's own slug (handling `.`/`..` segments).
- Every other href is **external** and ignored for graph purposes.
- Target and source slugs are normalized to a common shape regardless of `shortUrls`: leading `/`
  stripped, query/fragment stripped, a trailing `index.html`/`index.htm` collapsed away, otherwise a
  bare `.html`/`.htm` extension stripped, trailing `/` stripped. The site root normalizes to `""`.

### Scope

`scope: "collections"` decides whether a page counts as "in scope" (eligible to be scanned as a link
*source*) using a simple rule: a slug's first path segment must either name a key already present in
`config.collections` (when the site has any explicitly configured), or - when none are configured -
simply exist at all, since Steno auto-detects a collection from any `content/<folder>/` subdirectory
regardless of whether it's declared in config. A page with no folder segment (`/about`, `/404`) is
never in scope.

### Consuming the JSON index

This plugin's job stops at producing `<output>/_backlinks.json`; it does not inject the index back
into page frontmatter or template context itself - that would require materializing a virtual
content file per page so its data merges into `PageRenderContext`, which is out of scope for this
plugin. Making the index actually resolve inside a template is the theme's or site's own
responsibility - for example, loading `_backlinks.json` as a
[`_data/`](https://github.com/stenopress/steno/blob/main/docs/content.md) file, or writing a second
small plugin that reads it and republishes it under `globals` or `themeConfig`. The `field` option
exists purely so that consumer knows what key to mount it under.

## Test

```sh
deno task test
```

## Learn more

- [Steno plugin development guide](https://github.com/stenopress/steno/blob/main/docs/plugins.md)
- [Steno atomic builds](https://github.com/stenopress/steno/blob/main/docs/atomic_builds.md) - why `afterPage` sees staging paths, relevant to how this plugin derives slugs
- [Zola's built-in backlinks](https://www.getzola.org/documentation/templates/pages-sections/#backlinks) - the feature this plugin's approach was inspired by

## License

MIT
