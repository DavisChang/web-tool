'use strict';

// HTTP contract tests using supertest against the exported Express app.
// We do NOT bind a port (server.js only listens when run directly) and we
// never hit the real network — only validation/error branches plus the
// offline analyze/health endpoints are exercised. Run with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../server');

test('GET /api/health -> 200 { status: "ok" }', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('POST /api/analyze (happy path) -> 200 with html + analysis', async () => {
  const markdown = '# Hello\n\nSome **bold** text with a [link](https://example.com).';
  const res = await request(app)
    .post('/api/analyze')
    .send({ markdown });

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.html, 'string');
  assert.ok(res.body.html.length > 0);

  const a = res.body.analysis;
  assert.ok(a && typeof a === 'object');
  assert.equal(typeof a.wordCount, 'number');
  assert.equal(typeof a.charCount, 'number');
  assert.equal(typeof a.charCountNoSpaces, 'number');
  assert.equal(typeof a.lineCount, 'number');
  assert.equal(typeof a.readingTimeMinutes, 'number');
  assert.ok(Array.isArray(a.headings));
  assert.ok(Array.isArray(a.links));
  assert.ok(Array.isArray(a.images));
  assert.ok(Array.isArray(a.codeBlocks));
  assert.equal(typeof a.tables, 'number');
  assert.ok(a.tasks && typeof a.tasks.total === 'number' && typeof a.tasks.done === 'number');
  assert.ok(Array.isArray(a.toc));

  // Spot-check the parsed content matches the input.
  assert.equal(a.headings.length, 1);
  assert.equal(a.headings[0].text, 'Hello');
  assert.equal(a.links.length, 1);
  assert.equal(a.links[0].href, 'https://example.com');
});

test('POST /api/analyze accepts an empty string body as valid', async () => {
  const res = await request(app)
    .post('/api/analyze')
    .send({ markdown: '' });

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.html, 'string');
  assert.equal(res.body.analysis.wordCount, 0);
});

test('POST /api/analyze -> 400 when markdown missing', async () => {
  const res = await request(app)
    .post('/api/analyze')
    .send({});

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'markdown is required' });
});

test('POST /api/analyze -> 400 when markdown is not a string', async () => {
  const res = await request(app)
    .post('/api/analyze')
    .send({ markdown: 123 });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'markdown is required' });
});

test('GET /api/fetch -> 400 when url query param missing', async () => {
  const res = await request(app).get('/api/fetch');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'url is required' });
});

test('GET /api/fetch -> 400 invalid url for non-http(s) scheme', async () => {
  const res = await request(app)
    .get('/api/fetch')
    .query({ url: 'ftp://example.com/readme.md' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid url' });
});

test('GET /api/fetch -> 400 invalid url for malformed url', async () => {
  const res = await request(app)
    .get('/api/fetch')
    .query({ url: 'not a url' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'invalid url' });
});

test('GET /api/fetch -> 400 blocked host for http://localhost', async () => {
  const res = await request(app)
    .get('/api/fetch')
    .query({ url: 'http://localhost/readme.md' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'blocked host' });
});

test('GET /api/fetch -> 400 blocked host for RFC1918 10.x address', async () => {
  const res = await request(app)
    .get('/api/fetch')
    .query({ url: 'http://10.0.0.1/readme.md' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'blocked host' });
});

test('GET /api/fetch -> 400 blocked host for RFC1918 192.168.x address', async () => {
  const res = await request(app)
    .get('/api/fetch')
    .query({ url: 'http://192.168.1.1/readme.md' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'blocked host' });
});
