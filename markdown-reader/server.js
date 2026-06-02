'use strict';

/**
 * Express app for the Markdown Reader.
 * Exports the app for tests; only binds a port when run directly.
 */

const path = require('path');
const express = require('express');

const { analyze } = require('./lib/analyzer');
const { renderMarkdown } = require('./lib/render');
const { fetchMarkdown } = require('./lib/fetcher');

const app = express();

// Sensible default headers. Note: we deliberately do NOT send X-Frame-Options so
// the page can be embedded in an iframe / webview (see ?embed=1); the CSP
// frame-ancestors directive in index.html governs embedding instead.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '2mb' }));
// The static frontend lives at the project root so it also deploys cleanly to
// GitHub Pages at /<repo>/markdown-reader/. This optional dev server serves the
// same files (and, being a local OSS dev server, the source files too).
app.use(express.static(__dirname, { index: 'index.html' }));

// --- Health -----------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Analyze -----------------------------------------------------------------
app.post('/api/analyze', (req, res) => {
  const markdown = req.body && req.body.markdown;
  // Empty string is valid; only missing / non-string is rejected.
  if (typeof markdown !== 'string') {
    return res.status(400).json({ error: 'markdown is required' });
  }
  const html = renderMarkdown(markdown);
  const analysis = analyze(markdown);
  return res.json({ html, analysis });
});

// --- Fetch -------------------------------------------------------------------
app.get('/api/fetch', async (req, res) => {
  const url = req.query.url;
  if (typeof url !== 'string' || url === '') {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    const { url: finalUrl, markdown } = await fetchMarkdown(url);
    const html = renderMarkdown(markdown);
    const analysis = analyze(markdown);
    return res.json({ url: finalUrl, markdown, html, analysis });
  } catch (err) {
    switch (err && err.code) {
      case 'INVALID_URL':
        return res.status(400).json({ error: 'invalid url' });
      case 'BLOCKED_HOST':
        return res.status(400).json({ error: 'blocked host' });
      case 'FETCH_FAILED':
        return res.status(502).json({ error: `failed to fetch: ${err.reason || err.message}` });
      default:
        return res.status(502).json({ error: `failed to fetch: ${(err && err.message) || 'unknown error'}` });
    }
  }
});

// Bind a port only when executed directly (so supertest can import the app).
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Markdown Reader listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
