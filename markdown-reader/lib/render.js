'use strict';

/**
 * Markdown -> sanitized HTML.
 * marked parses, isomorphic-dompurify sanitizes the output so untrusted
 * markdown (e.g. fetched from a URL) cannot inject script/HTML.
 */

const { marked } = require('marked');
const DOMPurify = require('isomorphic-dompurify');

// Configure marked once, matching lib/analyzer.js.
marked.setOptions({ gfm: true, breaks: false });

/**
 * @param {string} markdown
 * @returns {string} sanitized HTML
 */
function renderMarkdown(markdown) {
  const md = typeof markdown === 'string' ? markdown : '';
  const rawHtml = marked.parse(md);
  return DOMPurify.sanitize(rawHtml);
}

module.exports = { renderMarkdown };
