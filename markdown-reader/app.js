/* ============================================================
   Markdown Reader — frontend logic
   Runs fully client-side so it works as a static site (e.g. GitHub Pages)
   with no backend:
   - Live preview rendered client-side (marked CDN), sanitized with DOMPurify.
   - Analysis computed client-side via analyzer.js (the same module that powers
     the server API at POST /api/analyze for programmatic / AI use).
   - URL bar fetches the document directly in the browser (CORS permitting).
   - Theme persisted in localStorage.
   ============================================================ */
(function () {
  'use strict';

  // ----- Canonical sample (shared with README; exercises every feature) -----
  var SAMPLE_MD = [
    '# Markdown Reader',
    '',
    'A **fast**, _polished_ markdown previewer with live analysis.',
    '',
    '## Features',
    '',
    '- Live preview',
    '- [x] Syntax analysis',
    '- [x] Dark mode',
    '- [ ] Export to PDF',
    '',
    '## Code',
    '',
    '```js',
    'const x = 42;',
    'console.log(x);',
    '```',
    '',
    '## Table',
    '',
    '| Feature | Status |',
    '|---------|--------|',
    '| Preview | Done |',
    '',
    '## Links & Images',
    '',
    'See [GitHub](https://github.com) and ![logo](https://example.com/logo.png).'
  ].join('\n');

  var THEME_KEY = 'md-reader-theme';
  var CONTENT_KEY = 'md-reader-content';
  var DEBOUNCE_MS = 300;

  // ----- Element handles -----
  var $ = function (id) { return document.getElementById(id); };
  var editor = $('editor');
  var preview = $('preview');
  var toast = $('toast');

  // Latest sanitized HTML from the client-side DOMPurify render — used by
  // Copy / Download HTML so we always export sanitized output.
  var latestHtml = '';

  /* ---------------- Theme ---------------- */
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (saved !== 'light' && saved !== 'dark') {
      saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', saved);
    syncThemeButton();
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    syncThemeButton();
  }
  // Keep the theme toggle's pressed state in sync for assistive tech.
  function syncThemeButton() {
    var btn = $('btn-theme');
    if (!btn) return;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  /* ---------------- URL parameters (deep-link & embedding) ---------------- */
  // Supports easy onboarding when embedded in an iframe / webview:
  //   ?embed=1            -> hide surrounding chrome for a clean embed
  //   ?theme=dark|light   -> force a theme for this session
  //   ?url=<encoded-url>  -> auto-load a Markdown document on open
  function applyUrlParams() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }

    var embed = params.get('embed');
    if (embed === '1' || embed === 'true') { document.body.classList.add('embed'); }

    var t = params.get('theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
      syncThemeButton();
    }

    var url = params.get('url');
    if (url) {
      var input = $('url-input');
      if (input) input.value = url;
      loadUrl(url);
    }
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function showToast(msg, kind) {
    toast.textContent = msg;
    toast.className = 'toast' + (kind ? ' ' + kind : '');
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2600);
  }
  function setStatus(msg) { $('status-left').textContent = msg; }

  /* ---------------- Slugify (mirrors server, for client anchors) ---------------- */
  function slugify(text) {
    var s = String(text).toLowerCase().trim();
    s = s.replace(/^[\*_~`]+|[\*_~`]+$/g, '');
    s = s.replace(/[^a-z0-9 \-]/g, '');
    s = s.replace(/\s+/g, '-');
    s = s.replace(/-+/g, '-');
    return s;
  }

  /* ---------------- Client-side live preview ---------------- */
  function renderPreview(md) {
    if (!window.marked || !window.DOMPurify) {
      // marked / DOMPurify still loading; retry shortly.
      setTimeout(function () { renderPreview(md); }, 60);
      return;
    }
    try { window.marked.setOptions({ gfm: true, breaks: false }); } catch (e) {}
    var rawHtml = window.marked.parse(md || '');
    // SECURITY: marked does not sanitize HTML. The markdown can be
    // attacker-controlled (e.g. fetched from a remote URL), so we must
    // sanitize before injecting it into the DOM to prevent DOM XSS.
    var html = window.DOMPurify.sanitize(rawHtml);
    latestHtml = html;
    preview.innerHTML = html;
    // Add heading anchors so the TOC links work.
    addHeadingIds();
  }

  function addHeadingIds() {
    var seen = {};
    var hs = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    hs.forEach(function (h) {
      var base = slugify(h.textContent || '');
      var slug = base;
      if (seen[base] != null) { seen[base] += 1; slug = base + '-' + seen[base]; }
      else { seen[base] = 0; }
      h.id = slug;
    });
  }

  /* ---------------- Analysis rendering ---------------- */
  function fmt(n) { return Number(n || 0).toLocaleString(); }

  function renderAnalysis(a) {
    if (!a) return;
    $('stat-words').textContent = fmt(a.wordCount);
    $('stat-read').textContent = fmt(a.readingTimeMinutes);
    $('stat-chars').textContent = fmt(a.charCount);
    $('stat-lines').textContent = fmt(a.lineCount);
    $('stat-chars-ns').textContent = fmt(a.charCountNoSpaces);
    $('stat-links').textContent = fmt((a.links || []).length);
    $('stat-images').textContent = fmt((a.images || []).length);
    $('stat-tables').textContent = fmt(a.tables);
    $('stat-code').textContent = fmt((a.codeBlocks || []).length);

    $('reading-time').textContent =
      (a.readingTimeMinutes || 0) + ' min read · ' + fmt(a.wordCount) + ' words';

    renderTasks(a.tasks || { total: 0, done: 0 });
    renderLangs(a.codeBlocks || []);
    renderToc(a.toc || a.headings || []);
  }

  function renderTasks(tasks) {
    var section = $('tasks-section');
    if (!tasks.total) { section.hidden = true; return; }
    section.hidden = false;
    var pct = Math.round((tasks.done / tasks.total) * 100);
    $('task-fill').style.width = pct + '%';
    $('task-label').textContent = tasks.done + ' / ' + tasks.total + ' done (' + pct + '%)';
    $('task-bar').setAttribute('aria-valuenow', String(pct));
  }

  function renderLangs(codeBlocks) {
    var section = $('langs-section');
    var list = $('lang-chips');
    // Tally languages (null -> "text").
    var counts = {};
    codeBlocks.forEach(function (cb) {
      var lang = cb.lang || 'text';
      counts[lang] = (counts[lang] || 0) + 1;
    });
    var keys = Object.keys(counts);
    if (!keys.length) { section.hidden = true; list.innerHTML = ''; return; }
    section.hidden = false;
    list.innerHTML = '';
    keys.forEach(function (k) {
      var li = document.createElement('li');
      li.textContent = counts[k] > 1 ? k + ' ×' + counts[k] : k;
      list.appendChild(li);
    });
  }

  function renderToc(headings) {
    var section = $('toc-section');
    var nav = $('toc');
    if (!headings.length) { section.hidden = true; nav.innerHTML = ''; return; }
    section.hidden = false;
    nav.innerHTML = '';
    headings.forEach(function (h) {
      var a = document.createElement('a');
      a.href = '#' + h.slug;
      a.textContent = h.text;
      a.setAttribute('data-level', String(h.level));
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        var target = document.getElementById(h.slug);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      nav.appendChild(a);
    });
  }

  /* ---------------- Analysis (computed client-side) ---------------- */
  // No server required: the same analyzer module also powers the server API
  // (POST /api/analyze) for programmatic / AI use when run with `npm start`.
  function runAnalysis(md) {
    var A = window.MarkdownAnalyzer;
    if (!A) { setTimeout(function () { runAnalysis(md); }, 60); return; } // analyzer still loading
    try {
      renderAnalysis(A.analyze(md));
      $('analysis-state').textContent = 'live';
    } catch (err) {
      $('analysis-state').textContent = 'error';
      setStatus('Analysis error: ' + err.message);
    }
  }

  /* ---------------- Load from URL (client-side fetch) ---------------- */
  // Rewrite a github.com/.../blob/... URL to its raw.githubusercontent.com form.
  function githubToRaw(target) {
    var u;
    try { u = new URL(target); } catch (e) { return target; }
    if (u.hostname === 'github.com' && u.pathname.indexOf('/blob/') !== -1) {
      var parts = u.pathname.split('/').filter(Boolean);
      var blobIdx = parts.indexOf('blob');
      if (blobIdx >= 2) {
        var rest = parts.slice(blobIdx + 1).join('/');
        return 'https://raw.githubusercontent.com/' + parts[0] + '/' + parts[1] + '/' + rest;
      }
    }
    return u.href;
  }

  // Browser-direct fetch (works for hosts that allow cross-origin reads, e.g.
  // raw.githubusercontent.com and many CDNs). When a host blocks CORS the
  // browser denies the read and we surface a clear, actionable message.
  function loadUrl(url) {
    var target = githubToRaw(url);
    setStatus('Fetching ' + target + ' …');
    fetch(target, { headers: { Accept: 'text/markdown, text/plain, text/*, */*' } })
      .then(function (res) {
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        return res.text();
      })
      .then(function (text) {
        editor.value = text;
        persist();
        renderPreview(text);
        runAnalysis(text);
        showToast('Loaded ' + target, 'ok');
        setStatus('Loaded from ' + target);
      })
      .catch(function (err) {
        showToast('Could not load that URL — the site may block cross-origin reads. Try a raw URL (e.g. raw.githubusercontent.com).', 'err');
        setStatus('Load failed: ' + err.message);
      });
  }

  /* ---------------- Debounced update on edit ---------------- */
  var debTimer = null;
  function scheduleUpdate() {
    persist();
    renderPreview(editor.value);            // instant client render
    clearTimeout(debTimer);
    debTimer = setTimeout(function () {
      runAnalysis(editor.value);            // recompute stats (debounced for big docs)
    }, DEBOUNCE_MS);
  }

  function persist() {
    try { localStorage.setItem(CONTENT_KEY, editor.value); } catch (e) {}
  }

  /* ---------------- Buttons ---------------- */
  function copyHtml() {
    if (!navigator.clipboard) { showToast('Clipboard unavailable', 'err'); return; }
    navigator.clipboard.writeText(latestHtml).then(function () {
      showToast('HTML copied to clipboard', 'ok');
    }, function () { showToast('Copy failed', 'err'); });
  }

  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadMd() {
    downloadFile('document.md', editor.value, 'text/markdown;charset=utf-8');
    showToast('Downloaded document.md', 'ok');
  }

  function downloadHtml() {
    var doc = [
      '<!DOCTYPE html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Markdown export</title>',
      '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;max-width:760px;margin:40px auto;padding:0 20px;color:#1d2433}pre{background:#f3f4f8;padding:14px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,Menlo,monospace}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 10px}img{max-width:100%}</style>',
      '</head><body>',
      latestHtml,
      '</body></html>'
    ].join('\n');
    downloadFile('document.html', doc, 'text/html;charset=utf-8');
    showToast('Downloaded document.html', 'ok');
  }

  function clearEditor() {
    editor.value = '';
    persist();
    renderPreview('');
    runAnalysis('');
    editor.focus();
    setStatus('Cleared.');
  }

  function loadSample() {
    editor.value = SAMPLE_MD;
    persist();
    renderPreview(SAMPLE_MD);
    runAnalysis(SAMPLE_MD);
    setStatus('Sample loaded.');
  }

  /* ---------------- Resizable split (desktop) ---------------- */
  function initGutter() {
    var gutter = $('gutter');
    var ws = $('workspace');
    var dragging = false;

    function applyFrac(editorFrac) {
      // Clamp 0.15..0.7 of the editor+preview area; analysis stays 300px.
      editorFrac = Math.max(0.15, Math.min(0.7, editorFrac));
      var previewFrac = 1 - editorFrac;
      ws.style.setProperty('--editor-frac', editorFrac.toFixed(3) + 'fr');
      ws.style.setProperty('--preview-frac', previewFrac.toFixed(3) + 'fr');
    }

    function onMove(clientX) {
      var rect = ws.getBoundingClientRect();
      var analysisW = 300;
      var usable = rect.width - analysisW - 6; // minus gutter
      var frac = (clientX - rect.left) / usable;
      applyFrac(frac);
    }

    gutter.addEventListener('mousedown', function (e) { dragging = true; e.preventDefault(); document.body.style.cursor = 'col-resize'; });
    window.addEventListener('mousemove', function (e) { if (dragging) { e.preventDefault(); onMove(e.clientX); } });
    window.addEventListener('mouseup', function () { dragging = false; document.body.style.cursor = ''; });

    // Keyboard accessible resize.
    gutter.addEventListener('keydown', function (e) {
      var cur = parseFloat(getComputedStyle(ws).getPropertyValue('--editor-frac')) || 1;
      // getComputedStyle returns the literal '1fr'; parse a fraction sensibly.
      var styleVal = ws.style.getPropertyValue('--editor-frac');
      var f = parseFloat(styleVal) || 0.45;
      if (e.key === 'ArrowLeft') { applyFrac(f - 0.04); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { applyFrac(f + 0.04); e.preventDefault(); }
    });

    // Sensible initial split.
    applyFrac(0.45);
  }

  /* ---------------- Wire up ---------------- */
  function init() {
    initTheme();
    initGutter();

    // Restore previous content, else show sample.
    var saved = null;
    try { saved = localStorage.getItem(CONTENT_KEY); } catch (e) {}
    editor.value = (saved != null && saved !== '') ? saved : SAMPLE_MD;

    renderPreview(editor.value);
    runAnalysis(editor.value);

    editor.addEventListener('input', scheduleUpdate);

    $('btn-theme').addEventListener('click', toggleTheme);
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-copy').addEventListener('click', copyHtml);
    $('btn-dl-md').addEventListener('click', downloadMd);
    $('btn-dl-html').addEventListener('click', downloadHtml);
    $('btn-clear').addEventListener('click', clearEditor);

    $('url-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('url-input').value.trim();
      if (!v) { showToast('Enter a URL first', 'err'); return; }
      loadUrl(v);
    });

    // Apply embed/theme/url query params last so a ?url= deep-link wins.
    applyUrlParams();

    setStatus('Ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
