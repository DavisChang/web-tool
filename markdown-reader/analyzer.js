/* ============================================================
   Markdown analysis — shared by the Node server and the browser.

   UMD module: the SAME source is the single source of truth.
   - In Node (CommonJS) it is re-exported by ../lib/analyzer.js and used by
     the server + tests; it pulls `marked` from require('marked').
   - In the browser it is loaded via <script src="analyzer.js"> and reads the
     global `marked` (from the CDN), exposing window.MarkdownAnalyzer.

   Uses marked's lexer/walkTokens as the single source of truth for all counts
   so the server, the tests, and the static (no-server) frontend all agree.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node / CommonJS
    const { marked } = require('marked');
    module.exports = factory(marked);
  } else {
    // Browser global (marked is loaded first via the CDN <script>)
    root.MarkdownAnalyzer = factory(root.marked);
  }
})(typeof self !== 'undefined' ? self : this, function (marked) {
  'use strict';

  // Keep marked configured consistently with rendering.
  marked.setOptions({ gfm: true, breaks: false });

  function unescapeHtml(text) {
    return String(text)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // Reconstruct plain text from a token's inline children, dropping markup
  // (link/image URLs, emphasis markers) so it matches GitHub's rendered text.
  function plainText(tokens) {
    return (tokens || [])
      .map(function (t) { return t.tokens ? plainText(t.tokens) : unescapeHtml(t.text || ''); })
      .join('');
  }

  // GitHub-style slugify: lowercase, strip surrounding inline markers, drop
  // anything that isn't [a-z0-9]/space/dash, spaces -> dashes, collapse dashes.
  function slugify(text) {
    var s = String(text == null ? '' : text).toLowerCase().trim();
    s = s.replace(/^[*_~`]+/, '').replace(/[*_~`]+$/, '');
    s = s.replace(/[^a-z0-9 \-]/g, '');
    s = s.replace(/\s+/g, '-');
    s = s.replace(/-+/g, '-');
    return s;
  }

  function analyze(markdown) {
    var md = typeof markdown === 'string' ? markdown : '';

    var wordCount = (md.match(/\S+/g) || []).length;
    var charCount = md.length;
    var charCountNoSpaces = md.replace(/\s/g, '').length;
    var lineCount = md === '' ? 0 : md.split('\n').length;
    var readingTimeMinutes = wordCount === 0 ? 0 : Math.ceil(wordCount / 200);

    var headings = [];
    var links = [];
    var images = [];
    var codeBlocks = [];
    var tables = 0;
    var tasksTotal = 0;
    var tasksDone = 0;

    // Track slug occurrences to apply GitHub's "-1", "-2" disambiguation.
    var slugCounts = Object.create(null);
    function uniqueSlug(base) {
      if (slugCounts[base] === undefined) {
        slugCounts[base] = 0;
        return base;
      }
      slugCounts[base] += 1;
      return base + '-' + slugCounts[base];
    }

    var tokens;
    try {
      tokens = marked.lexer(md);
    } catch (_e) {
      tokens = [];
    }

    marked.walkTokens(tokens, function (token) {
      switch (token.type) {
        case 'heading': {
          var text = token.tokens ? plainText(token.tokens) : token.text || '';
          var base = slugify(text);
          headings.push({ level: token.depth, text: text, slug: uniqueSlug(base) });
          break;
        }
        case 'link':
          links.push({ text: token.text || '', href: token.href || '' });
          break;
        case 'image':
          images.push({ alt: token.text || '', src: token.href || '' });
          break;
        case 'code': {
          // Block-level code only ('codespan' is inline and intentionally skipped).
          var lang = token.lang ? token.lang : null;
          var body = token.text || '';
          codeBlocks.push({ lang: lang, lines: body.split('\n').length });
          break;
        }
        case 'table':
          tables += 1;
          break;
        case 'list_item':
          if (token.task === true) {
            tasksTotal += 1;
            if (token.checked === true) tasksDone += 1;
          }
          break;
        default:
          break;
      }
    });

    var toc = headings.map(function (h) { return { level: h.level, text: h.text, slug: h.slug }; });

    return {
      wordCount: wordCount,
      charCount: charCount,
      charCountNoSpaces: charCountNoSpaces,
      lineCount: lineCount,
      readingTimeMinutes: readingTimeMinutes,
      headings: headings,
      links: links,
      images: images,
      codeBlocks: codeBlocks,
      tables: tables,
      tasks: { total: tasksTotal, done: tasksDone },
      toc: toc,
    };
  }

  return { analyze: analyze, slugify: slugify };
});
