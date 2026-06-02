# Markdown Reader

A fast, polished Markdown previewer with **live preview** and **document analysis**.
Inspired by [markdownlivepreview.com](https://markdownlivepreview.com/), but with more
features and a cleaner, themeable UI.

GitHub Pages URL: <https://davischang.github.io/web-tool/markdown-reader/>

This is a **sub-project of [`web-tool`](../)**. It works in two modes from one codebase:

- **Static frontend** (no backend) — the page renders, analyzes, and even loads
  Markdown from a URL entirely in the browser, so it deploys as a plain static site
  (e.g. **GitHub Pages**). The analysis is computed client-side by `analyzer.js`.
- **Optional API server** — `server.js` (Node + Express) exposes the same analysis as a
  JSON HTTP API for programmatic / AI use, and can fetch arbitrary URLs server-side
  (with SSRF protection) when the browser's CORS rules would block a direct fetch.

The browser and the server share **one analyzer module** (`analyzer.js`, used by the
server via `lib/analyzer.js`) so the numbers always agree.

## Features

- Split-pane editor with **live preview** as you type (debounced).
- **Analysis panel**: word count, reading time, headings table-of-contents with anchor
  links, link/image counts, task-list progress, code-block languages, table count.
- **Light / Dark theme** toggle, persisted in `localStorage`.
- **Load from URL**: paste a raw Markdown URL (or a GitHub `blob` URL — rewritten to
  `raw.githubusercontent.com` automatically). The static site fetches it directly in the
  browser (works for CORS-enabled hosts such as `raw.githubusercontent.com`); the API
  server's `GET /api/fetch` can fetch any host server-side.
- **HTML sanitization** with DOMPurify in the browser and `isomorphic-dompurify` on the
  server, so rendered output is safe either way.
- One-click **Copy HTML**, **Download .md**, **Download .html**, **Clear**, and
  **Load sample**.
- Sensible default sample markdown on first load.

## Tech stack

- Plain static HTML/CSS/JS frontend (no framework, no build step).
- [`marked`](https://www.npmjs.com/package/marked) for parsing/rendering (CDN in the
  browser, npm on the server); DOMPurify / `isomorphic-dompurify` for sanitization.
- Optional server: Node.js 18+ (global `fetch`), Express (CommonJS).
- Tests with the built-in `node:test` runner + [`supertest`](https://www.npmjs.com/package/supertest).

## Getting started

The frontend is just static files — open `index.html`, or serve the folder with any
static server. To also run the **API server**:

```bash
# from this directory: /web-tool/markdown-reader
npm install      # install dependencies (only needed for the API server / tests)
npm start        # start the server on http://localhost:3000 (serves the site + API)
npm test         # run the test suite (node --test)
```

`npm start` runs `node server.js`. Override the port with the `PORT` environment
variable, e.g. `PORT=8080 npm start`.

## Deploy to GitHub Pages

Because the frontend is self-contained, no build step is required:

1. Commit these files (they sit at the repo path `markdown-reader/`).
2. Enable GitHub Pages for the repo (Settings → Pages → deploy from branch).
3. The app is served at `https://<user>.github.io/<repo>/markdown-reader/`
   (for this repo: `https://davischang.github.io/web-tool/markdown-reader/`).

What works on Pages: live preview, client-side analysis, theme, export, embedding, and
loading Markdown from **HTTPS CORS-enabled** URLs (e.g. `raw.githubusercontent.com`,
jsDelivr). GitHub `blob` links are rewritten to `raw.githubusercontent.com` first.

What needs the API server instead: fetching URLs from hosts that block cross-origin
reads, fetching non-HTTPS URLs from an HTTPS page, and the JSON API endpoints (`/api/*`).

> **Notes for Pages:** update the placeholder host
> `https://davischang.github.io/web-tool/markdown-reader/` in `index.html` (canonical /
> Open Graph), `sitemap.xml`, and `robots.txt` if you deploy elsewhere. `robots.txt` /
> `sitemap.xml` are only authoritative at a domain root; on a project page
> (`/web-tool/...`) submit the sitemap URL to Search Console directly.

## Embedding & deep links

Markdown Reader is designed to be dropped into an `<iframe>` or a mobile **webview**.
Query parameters make it easy to onboard:

| Parameter | Effect |
|-----------|--------|
| `?embed=1` | Hides the surrounding chrome (brand, status bar, About section) for a clean embed. |
| `?url=<encoded-url>` | Auto-loads a Markdown document from that URL on open. |
| `?theme=dark` / `?theme=light` | Forces a theme for the session (otherwise stored choice / system preference). |

Example: `…/markdown-reader/?embed=1&theme=dark&url=https%3A%2F%2Fraw.githubusercontent.com%2Fexpressjs%2Fexpress%2Fmaster%2FReadme.md`

The server does **not** send `X-Frame-Options`, and the page's CSP uses
`frame-ancestors *`, so embedding works out of the box. Tighten `frame-ancestors` to
specific origins if you only want trusted hosts to embed it.

## SEO & AI discoverability

The frontend ships with search- and AI-friendly metadata so the tool is easy to find,
index, and cite:

- Descriptive `<title>`/`description`, canonical URL, Open Graph + Twitter cards, and a
  generated social image (`og-image.svg`).
- JSON-LD structured data (`WebApplication` + `FAQPage`) embedded in the page.
- `robots.txt` (explicitly allows major search and AI crawlers) and `sitemap.xml`.
- `llms.txt` — an [llms.txt](https://llmstxt.org/)-style summary so AI assistants can
  accurately describe and recommend the tool.
- A human-readable About/FAQ section in the page for both readers and crawlers.

> **Deploying:** the canonical/Open Graph URLs and `robots.txt`/`sitemap.xml` use the
> placeholder host `https://davischang.github.io/web-tool/markdown-reader/`. Replace it
> with your production domain on deploy.

## Project layout

```
markdown-reader/
├── index.html          # static frontend (the GitHub Pages entry point)
├── app.js              # frontend logic — client-side render + analysis + URL load
├── analyzer.js         # UMD analysis module shared by the browser AND the server
├── styles.css          # theming (CSS variables) + responsive / embed styles
├── purify.min.js       # DOMPurify (client-side sanitization)
├── og-image.svg, favicon.svg               # social card + icon
├── robots.txt, sitemap.xml, llms.txt       # SEO / AI discoverability
├── server.js           # OPTIONAL Express app + API; serves the site too
├── lib/
│   ├── analyzer.js     # thin re-export of ../analyzer.js for the server
│   ├── fetcher.js      # fetch a URL server-side with SSRF protection (no Express)
│   └── render.js       # markdown -> sanitized HTML (marked + dompurify)
└── test/               # node:test suites (analyzer + API)
```

## API (optional server)

When you run `npm start`, the server exposes a small, stable HTTP API (JSON responses).
The static site does **not** require it — it is for programmatic / AI use.

### `GET /api/health`

Health check.

```bash
curl http://localhost:3000/api/health
```

```json
{ "status": "ok" }
```

### `POST /api/analyze`

Render markdown to sanitized HTML and compute the analysis object.

- Body: `{ "markdown": "<string>" }` (an empty string is valid).
- `400 { "error": "markdown is required" }` when `markdown` is missing or not a string.

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"markdown":"# Hello\n\nSome **bold** text and a [link](https://example.com)."}'
```

```json
{
  "html": "<h1 id=\"hello\">Hello</h1>\n<p>Some <strong>bold</strong> text and a <a href=\"https://example.com\">link</a>.</p>\n",
  "analysis": {
    "wordCount": 8,
    "charCount": 62,
    "charCountNoSpaces": 54,
    "lineCount": 3,
    "readingTimeMinutes": 1,
    "headings": [{ "level": 1, "text": "Hello", "slug": "hello" }],
    "links": [{ "text": "link", "href": "https://example.com" }],
    "images": [],
    "codeBlocks": [],
    "tables": 0,
    "tasks": { "total": 0, "done": 0 },
    "toc": [{ "level": 1, "text": "Hello", "slug": "hello" }]
  }
}
```

### `GET /api/fetch?url=<encoded url>`

Fetch a URL server-side (avoids browser CORS) and return its raw markdown, sanitized
HTML, and analysis. If the URL is a `github.com/.../blob/...` page it is transformed to
`raw.githubusercontent.com` before fetching.

- `200 { "url", "markdown", "html", "analysis" }` on success (`url` is the final URL
  actually fetched).
- `400 { "error": "url is required" }` when the `url` query param is missing.
- `400 { "error": "invalid url" }` when the URL is not `http`/`https`.
- `400 { "error": "blocked host" }` for internal/SSRF-prone hosts (`localhost`,
  `127.0.0.0/8`, `0.0.0.0`, `::1`, `169.254.0.0/16` link-local incl. `169.254.169.254`,
  `*.local`, and RFC1918 ranges `10.x`, `192.168.x`, `172.16–31.x`).
- `502 { "error": "failed to fetch: <reason>" }` on a network error or non-2xx upstream
  response.

```bash
curl 'http://localhost:3000/api/fetch?url=https%3A%2F%2Fraw.githubusercontent.com%2Fexpressjs%2Fexpress%2Fmaster%2FReadme.md'
```

```json
{
  "url": "https://raw.githubusercontent.com/expressjs/express/master/Readme.md",
  "markdown": "# Express\n\nFast, unopinionated, minimalist web framework...",
  "html": "<h1 id=\"express\">Express</h1>...",
  "analysis": { "wordCount": 0, "...": "see Analysis object below" }
}
```

### Analysis object

```jsonc
{
  "wordCount": 0,             // whitespace-delimited tokens in the raw markdown
  "charCount": 0,             // markdown.length
  "charCountNoSpaces": 0,     // markdown with all whitespace removed
  "lineCount": 0,             // number of lines (0 for empty string)
  "readingTimeMinutes": 0,    // ceil(wordCount / 200)
  "headings": [               // GitHub-style slugs, de-duplicated within a doc
    { "level": 1, "text": "Title", "slug": "title" }
  ],
  "links":  [ { "text": "GitHub", "href": "https://github.com" } ],
  "images": [ { "alt": "logo", "src": "https://example.com/logo.png" } ],
  "codeBlocks": [ { "lang": "js", "lines": 2 } ],  // lang null when unspecified
  "tables": 0,
  "tasks": { "total": 0, "done": 0 },              // - [ ] / - [x]
  "toc": []                                        // convenience copy of headings
}
```

## Testing

```bash
npm test
```

This runs both suites with `node --test`:

- `test/analyzer.test.js` — pure unit tests for `lib/analyzer.js` (counts, slugs, headings,
  links, images, code blocks, tasks, tables, reading time, empty input).
- `test/api.test.js` — `supertest` tests for the HTTP contract. These cover the
  validation and SSRF branches only and never make real network calls.

## FAQ

**What is Markdown Reader?** A free web app that renders a live preview of Markdown and
computes a structured analysis (word count, reading time, headings, links, images, code
blocks, tasks, tables), plus a JSON API for programmatic and AI use.

**Can it read Markdown from a URL?** Yes — on GitHub Pages, paste an HTTPS
CORS-enabled Markdown URL or a GitHub `blob` link; it is fetched in the browser,
rendered, and analyzed. Run the optional API server when you need CORS-free
server-side fetching.

**Does it have an API?** Yes — `POST /api/analyze`, `GET /api/fetch?url=`, and
`GET /api/health`. See [API](#api) above.

**How is it different from markdownlivepreview.com?** It adds URL loading, a documented
analysis API, a table-of-contents/statistics panel, themes, export, and an embeddable
webview mode, with a different, more polished UI.
