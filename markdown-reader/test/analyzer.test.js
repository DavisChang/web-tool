'use strict';

// Unit tests for the pure markdown analyzer (lib/analyzer.js).
// These tests are I/O-free and assert the exact Analysis object shape
// documented in the API contract. Run with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../lib/analyzer');

// A rich fixture that exercises every analysis feature. It is intentionally
// kept parseable by `marked` so backend, frontend and tests all agree.
//
// Counts derived from the contract's RAW-markdown rules:
//   - 3 headings (H1 "Title", H2 "Section One", H2 "Section One" duplicate)
//   - 1 link, 1 image
//   - 1 fenced code block (lang=js, 2 lines)
//   - 1 table
//   - tasks: 3 total / 2 done
const RICH_MD = [
  '# Title',
  '',
  'A **fast**, _polished_ markdown previewer with some words here.',
  '',
  '## Section One',
  '',
  '- Live preview',
  '- [x] Syntax analysis',
  '- [x] Dark mode',
  '- [ ] Export to PDF',
  '',
  '## Section One',
  '',
  '```js',
  'const x = 42;',
  'console.log(x);',
  '```',
  '',
  '| Feature | Status |',
  '|---------|--------|',
  '| Preview | Done |',
  '',
  'See [GitHub](https://github.com) and ![logo](https://example.com/logo.png).',
  '',
].join('\n');

test('analyze: wordCount counts whitespace-delimited tokens on raw markdown', () => {
  const a = analyze(RICH_MD);
  const expected = (RICH_MD.match(/\S+/g) || []).length;
  assert.equal(a.wordCount, expected);
  assert.ok(a.wordCount > 0);
});

test('analyze: char counts and line count', () => {
  const a = analyze(RICH_MD);
  assert.equal(a.charCount, RICH_MD.length);
  assert.equal(a.charCountNoSpaces, RICH_MD.replace(/\s/g, '').length);
  assert.equal(a.lineCount, RICH_MD.split('\n').length);
});

test('analyze: readingTimeMinutes = ceil(wordCount / 200)', () => {
  const a = analyze(RICH_MD);
  assert.equal(a.readingTimeMinutes, Math.ceil(a.wordCount / 200));
});

test('analyze: headings carry level, text and GitHub-style slug', () => {
  const a = analyze(RICH_MD);
  assert.equal(a.headings.length, 3);

  assert.deepEqual(a.headings[0], { level: 1, text: 'Title', slug: 'title' });
  assert.equal(a.headings[1].level, 2);
  assert.equal(a.headings[1].text, 'Section One');
  assert.equal(a.headings[1].slug, 'section-one');

  // Duplicate heading text must produce a unique, de-duplicated slug.
  assert.equal(a.headings[2].text, 'Section One');
  assert.equal(a.headings[2].slug, 'section-one-1');

  // Every slug is unique within a single analyze() call.
  const slugs = a.headings.map((h) => h.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('analyze: toc mirrors headings (same contents, separate array)', () => {
  const a = analyze(RICH_MD);
  assert.deepEqual(a.toc, a.headings);
  assert.notEqual(a.toc, a.headings); // distinct array instances
});

test('analyze: links extracted with text and href', () => {
  const a = analyze(RICH_MD);
  assert.equal(a.links.length, 1);
  assert.deepEqual(a.links[0], { text: 'GitHub', href: 'https://github.com' });
});

test('analyze: images extracted with alt and src', () => {
  const a = analyze(RICH_MD);
  assert.equal(a.images.length, 1);
  assert.deepEqual(a.images[0], {
    alt: 'logo',
    src: 'https://example.com/logo.png',
  });
});

test('analyze: code blocks report lang and line count (inline code ignored)', () => {
  const a = analyze(RICH_MD);
  assert.equal(a.codeBlocks.length, 1);
  assert.deepEqual(a.codeBlocks[0], { lang: 'js', lines: 2 });
});

test('analyze: fenced block with no language has lang === null', () => {
  const md = ['```', 'plain text', '```'].join('\n');
  const a = analyze(md);
  assert.equal(a.codeBlocks.length, 1);
  assert.equal(a.codeBlocks[0].lang, null);
  assert.equal(a.codeBlocks[0].lines, 1);
});

test('analyze: inline codespan is NOT counted as a code block', () => {
  const a = analyze('This has `inline code` only.');
  assert.equal(a.codeBlocks.length, 0);
});

test('analyze: tables counted', () => {
  const a = analyze(RICH_MD);
  assert.equal(a.tables, 1);
});

test('analyze: tasks report total and done', () => {
  const a = analyze(RICH_MD);
  assert.deepEqual(a.tasks, { total: 3, done: 2 });
});

test('analyze: empty string yields zeroed analysis', () => {
  const a = analyze('');
  assert.equal(a.wordCount, 0);
  assert.equal(a.charCount, 0);
  assert.equal(a.charCountNoSpaces, 0);
  assert.equal(a.lineCount, 0);
  assert.equal(a.readingTimeMinutes, 0);
  assert.deepEqual(a.headings, []);
  assert.deepEqual(a.toc, []);
  assert.deepEqual(a.links, []);
  assert.deepEqual(a.images, []);
  assert.deepEqual(a.codeBlocks, []);
  assert.equal(a.tables, 0);
  assert.deepEqual(a.tasks, { total: 0, done: 0 });
});

test('analyze: slugify strips inline formatting and punctuation', () => {
  const md = '# Hello, *World*! `code` & stuff';
  const a = analyze(md);
  assert.equal(a.headings.length, 1);
  // lowercase, punctuation removed, spaces -> single dashes
  assert.equal(a.headings[0].slug, 'hello-world-code--stuff'.replace(/-+/g, '-'));
  assert.equal(a.headings[0].slug, 'hello-world-code-stuff');
});
