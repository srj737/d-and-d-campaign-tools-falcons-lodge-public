/* Campaign Chronicle: gallery, slideshow and workshop. No build step, no dependencies. */
(() => {
  'use strict';

  /* ------------------------------------------------------------ utilities */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const P = { base: '' };   // folder prefix inside the repository, from site.json (repo_path)
  const money = (n) => '$' + (Number(n) || 0).toFixed(2);

  const mem = {};
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
    del(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } },
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = true;
      else if (k === 'disabled') el.disabled = true;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'session';

  async function getJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }

  /* ------------------------------------------------------------ settings */
  const S = {
    get repo() { return store.get('dnd_repo') || ''; },
    get token() { return store.get('dnd_token') || ''; },
    get branch() { return store.get('dnd_branch') || 'main'; },
  };

  /* ------------------------------------------------------------ GitHub API (workshop only) */
  async function api(path, opts = {}) {
    return fetch('https://api.github.com' + path, {
      ...opts,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${S.token}`,
        ...(opts.headers || {}),
      },
    });
  }

  async function repoText(path) {
    const res = await api(`/repos/${S.repo}/contents/${path}?ref=${encodeURIComponent(S.branch)}`,
      { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub returned ${res.status} while reading ${path}`);
    return res.text();
  }
  async function repoJson(path) {
    const t = await repoText(path);
    return t == null ? null : JSON.parse(t);
  }
  async function repoList(path) {
    const res = await api(`/repos/${S.repo}/contents/${path}?ref=${encodeURIComponent(S.branch)}`);
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? j.filter((f) => f.type === 'file' && /\.(png|jpe?g|webp)$/i.test(f.name)).map((f) => f.name) : [];
  }
  const blobUrls = new Map();
  async function repoImage(path) {
    if (blobUrls.has(path)) return blobUrls.get(path);
    const res = await api(`/repos/${S.repo}/contents/${path}?ref=${encodeURIComponent(S.branch)}`,
      { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!res.ok) throw new Error('image not available yet');
    const url = URL.createObjectURL(await res.blob());
    blobUrls.set(path, url);
    return url;
  }

  /* ------------------------------------------------------------ site chrome */
  async function loadSite() {
    try {
      const site = await getJson('site.json');
      $('#site-title').textContent = site.title || 'Campaign Chronicle';
      $('#site-sub').textContent = site.subtitle || '';
      document.title = site.title || 'Campaign Chronicle';
      P.base = site.repo_path ? String(site.repo_path).replace(/^\/+|\/+$/g, '') + '/' : '';
    } catch { /* defaults stay */ }
  }

  function setNav(name) {
    $$('nav a').forEach((a) => {
      if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      a.classList.toggle('active', a.dataset.nav === name);
    });
  }

  /* ------------------------------------------------------------ gallery */
  let galleryShown = false;

  async function showGallery() {
    setNav('gallery');
    if (galleryShown) return;
    const app = $('#app');
    app.replaceChildren(h('div', { class: 'wrap' }, h('p', { class: 'muted' }, 'Loading sessions…')));
    let list = [];
    try { list = (await getJson('data/index.json')).sessions.filter((s) => s.count > 0); }
    catch { /* shows empty state */ }
    const grid = list.length
      ? h('div', { class: 'grid' }, list.map((s) =>
        h('a', { class: 'sess', href: `#/s/${s.id}` },
          s.cover ? h('img', { src: s.cover, alt: '', loading: 'lazy' }) : null,
          h('span', { class: 'badge' }, `${s.count} ${s.count === 1 ? 'image' : 'images'}`),
          h('div', { class: 'sess-meta' }, h('h3', null, s.title), h('span', null, s.date)))))
      : h('div', { class: 'empty' },
        h('p', null, 'No sessions have been illustrated yet.'),
        h('a', { href: '#/workshop' }, 'Open the workshop to create the first one'));
    app.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'hero' }, h('h1', null, 'Sessions'),
        h('p', null, 'Pick a session to watch it as a slideshow.')), grid));
    galleryShown = true;
  }

  /* ------------------------------------------------------------ slideshow viewer */
  const V = { open: false, session: null, i: 0, timer: null, idle: null, returnFocus: null };

  async function openViewer(sid, start) {
    const box = $('#viewer');
    let session;
    try { session = await getJson(`data/sessions/${sid}/session.json`); }
    catch {
      location.hash = '#/';
      return;
    }
    if (!session.images || !session.images.length) { location.hash = '#/'; return; }
    V.session = session;
    V.open = true;
    V.returnFocus = document.activeElement;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    box.replaceChildren(
      h('div', { class: 'v-top' },
        h('h2', null, session.title),
        h('span', { class: 'v-count', id: 'v-count', 'aria-live': 'polite' }),
        h('button', { class: 'btn ghost small', id: 'v-story-btn', hidden: true, 'aria-expanded': 'false', title: 'Read the write-up (r)', onclick: toggleStory }, 'Story'),
        h('button', { class: 'icon-btn', id: 'v-play', 'aria-label': 'Autoplay', 'aria-pressed': 'false', title: 'Autoplay (space)', onclick: toggleAuto }, '▶'),
        h('button', { class: 'icon-btn', 'aria-label': 'Full screen', title: 'Full screen (f)', onclick: toggleFull }, '⛶'),
        h('button', { class: 'icon-btn', id: 'v-close', 'aria-label': 'Close slideshow', title: 'Close (esc)', onclick: closeViewer }, '✕')),
      h('div', { class: 'v-stage', id: 'v-stage' },
        h('img', { id: 'v-img', alt: '' }),
        h('button', { class: 'icon-btn v-nav prev', 'aria-label': 'Previous image', onclick: () => go(-1) }, '‹'),
        h('button', { class: 'icon-btn v-nav next', 'aria-label': 'Next image', onclick: () => go(1) }, '›'),
        h('div', { class: 'v-cap' }, h('p', { id: 'v-text' }), h('div', { class: 'v-dots', id: 'v-dots' }))));
    show(Math.min(Math.max(start || 0, 0), session.images.length - 1), true);
    loadStory(session);
    $('#v-close').focus();
    document.addEventListener('keydown', onKey);
    box.addEventListener('mousemove', wake);
    box.addEventListener('touchstart', onTouchStart, { passive: true });
    box.addEventListener('touchend', onTouchEnd, { passive: true });
    wake();
  }

  function show(i, instant) {
    const imgs = V.session.images;
    V.i = (i + imgs.length) % imgs.length;
    const im = imgs[V.i];
    const el = $('#v-img');
    const apply = () => {
      el.src = im.file;
      el.alt = im.caption || V.session.title;
      el.classList.remove('fade');
    };
    if (instant) apply(); else { el.classList.add('fade'); setTimeout(apply, 220); }
    $('#v-text').textContent = im.caption || '';
    $('#v-count').textContent = `${V.i + 1} / ${imgs.length}`;
    const dots = $('#v-dots');
    dots.replaceChildren(...(imgs.length > 1 && imgs.length <= 20 ? imgs.map((_, n) =>
      h('button', { 'aria-label': `Go to image ${n + 1}`, 'aria-current': String(n === V.i), onclick: () => show(n) })) : []));
    history.replaceState(null, '', `#/s/${V.session.id}/${V.i + 1}`);
    const nxt = imgs[(V.i + 1) % imgs.length];
    if (nxt) new Image().src = nxt.file;
  }

  const go = (d) => { show(V.i + d); restartAuto(); };

  /* the session write-up, published next to session.json; the Story button only appears if it exists */
  async function loadStory(session) {
    if (session.writeup_public !== true) return;
    try {
      const res = await fetch(`data/sessions/${session.id}/writeup.md`, { cache: 'no-store' });
      if (!res.ok) return;
      const text = (await res.text()).trim();
      if (!text || !V.open || V.session !== session) return;
      const paras = text.split(/\n\s*\n/).map((p) => h('p', null, p.trim()));
      $('#viewer').append(h('div', { class: 'v-story', id: 'v-story', hidden: true, role: 'region', 'aria-label': 'Session write-up' },
        h('div', { class: 'v-story-inner' }, h('h2', null, session.title), h('p', { class: 'muted small' }, 'The write-up this session was illustrated from.'), paras)));
      $('#v-story-btn').hidden = false;
    } catch { /* no write-up: no button */ }
  }
  function toggleStory(force) {
    const panel = $('#v-story'), btn = $('#v-story-btn');
    if (!panel) return false;
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Close story' : 'Story';
    if (open) panel.querySelector('.v-story-inner').scrollTop = 0;
    return open;
  }

  function toggleAuto() {
    const btn = $('#v-play');
    if (V.timer) { clearInterval(V.timer); V.timer = null; btn.setAttribute('aria-pressed', 'false'); btn.textContent = '▶'; return; }
    btn.setAttribute('aria-pressed', 'true'); btn.textContent = '❚❚';
    V.timer = setInterval(() => show(V.i + 1), 7000);
  }
  function restartAuto() {
    if (!V.timer) return;
    clearInterval(V.timer);
    V.timer = setInterval(() => show(V.i + 1), 7000);
  }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#viewer').requestFullscreen?.().catch(() => {});
  }
  function wake() {
    const box = $('#viewer');
    box.classList.remove('idle');
    clearTimeout(V.idle);
    V.idle = setTimeout(() => box.classList.add('idle'), 3500);
  }
  let touchX = null;
  const onTouchStart = (e) => { touchX = e.changedTouches[0].clientX; wake(); };
  const onTouchEnd = (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  };
  function onKey(e) {
    if (!V.open) return;
    wake();
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Escape') { const p = $('#v-story'); if (p && !p.hidden) toggleStory(false); else closeViewer(); }
    else if (e.key.toLowerCase() === 'r' && $('#v-story')) toggleStory();
    else if (e.key === ' ' && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); toggleAuto(); }
    else if (e.key.toLowerCase() === 'f') toggleFull();
  }
  function teardownViewer() {
    if (!V.open) return;
    V.open = false;
    clearInterval(V.timer); V.timer = null;
    clearTimeout(V.idle);
    const box = $('#viewer');
    box.hidden = true;
    box.replaceChildren();
    box.classList.remove('idle');
    box.removeEventListener('mousemove', wake);
    box.removeEventListener('touchstart', onTouchStart);
    box.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    V.returnFocus?.focus?.();
  }
  function closeViewer() {
    teardownViewer();
    if (location.hash.startsWith('#/s/')) location.hash = '#/';
  }

  /* ------------------------------------------------------------ settings dialog */
  function openSettings() {
    const dlg = $('#settings');
    $('#s-repo').value = S.repo;
    $('#s-token').value = S.token;
    setMsg('', '');
    dlg.showModal();
  }
  function setMsg(text, kind) {
    const m = $('#s-msg');
    m.textContent = text;
    m.className = 'note ' + (kind || '');
  }
  async function saveSettings() {
    const repo = $('#s-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    const token = $('#s-token').value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { setMsg('Enter the repository as owner/repo and paste the token.', 'err'); return; }
    store.set('dnd_repo', repo); store.set('dnd_token', token);
    setMsg('Testing…', '');
    try {
      const r = await api(`/repos/${repo}`);
      if (r.status === 401) throw new Error('GitHub rejected the token.');
      if (!r.ok) throw new Error(`Cannot see the repository (HTTP ${r.status}). Check the name and the token's repository access.`);
      const info = await r.json();
      store.set('dnd_branch', info.default_branch || 'main');
      const w = await api(`/repos/${repo}/actions/workflows/dnd.yml`);
      if (!w.ok) throw new Error('The repository is reachable, but the "DnD pipeline" workflow was not found or the token lacks Actions permission.');
      const c = await api(`/repos/${repo}/contents/${P.base}config.json?ref=${encodeURIComponent(info.default_branch || 'main')}`);
      if (!c.ok) throw new Error('Could not read config.json: give the token Contents: Read-only.');
      setMsg('Connected.', 'ok');
      setTimeout(() => { $('#settings').close(); if (location.hash.startsWith('#/workshop')) route(true); }, 600);
    } catch (e) { setMsg(e.message || String(e), 'err'); }
  }
  function wireSettings() {
    $('#settings-form').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
    $('#s-save').addEventListener('click', saveSettings);
    $('#s-close').addEventListener('click', () => $('#settings').close());
    $('#s-forget').addEventListener('click', () => {
      store.del('dnd_token'); $('#s-token').value = ''; setMsg('Token removed from this browser.', 'ok');
      if (location.hash.startsWith('#/workshop')) route(true);
    });
  }

  /* ------------------------------------------------------------ workshop */
  const W = { cfg: null, usage: null, index: null, chars: [], sid: null, session: null, stage: 'scenes',
              selected: new Set(), busy: false, banner: null, dry: false, loadedFor: null };

  const imgCost = () => W.cfg.prices.image_usd[W.cfg.image_quality] || 0.1;
  const refCost = () => W.cfg.prices.reference_image_usd || 0;

  async function showWorkshop(sid, force) {
    setNav('workshop');
    galleryShown = false;
    const app = $('#app');
    if (!S.repo || !S.token) {
      app.replaceChildren(h('div', { class: 'wrap' },
        h('div', { class: 'panel' },
          h('h1', null, 'Workshop'),
          h('p', { class: 'muted' }, 'Connect this page to your repository to turn session write-ups into illustrations. You only need to do this once per browser.'),
          h('button', { class: 'btn primary', onclick: openSettings }, 'Connect to GitHub'))));
      return;
    }
    if (W.busy && !force) return;
    app.replaceChildren(h('div', { class: 'wrap' }, h('p', { class: 'muted' }, 'Loading workshop…')));
    try {
      const [cfg, usage, index, chars] = await Promise.all([
        repoJson(P.base + 'config.json'), repoJson(P.base + 'docs/data/usage.json'), repoJson(P.base + 'docs/data/index.json'),
        repoList(P.base + 'characters').catch(() => [])]);
      if (!cfg) throw new Error('config.json was not found in the repository.');
      W.cfg = cfg; W.usage = usage || { spent_usd: 0, budget_usd: cfg.caps.monthly_budget_usd };
      W.index = index || { sessions: [] };
      W.chars = chars || [];
      if (sid) {
        W.session = await repoJson(`${P.base}docs/data/sessions/${sid}/session.json`);
        if (!W.session) throw new Error('That session was not found.');
        if (W.loadedFor !== sid) {
          W.stage = { scenes: 'scenes', prompts: 'prompts', done: 'images' }[W.session.status] || 'scenes';
          W.selected = new Set(W.session.selected && W.session.selected.length ? W.session.selected : W.session.scenes.map((s) => s.id));
        }
      } else { W.session = null; }
      W.sid = sid || null;
      W.loadedFor = sid || null;
      paint();
    } catch (e) {
      app.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'panel' },
        h('h2', null, 'Could not load the workshop'),
        h('p', { class: 'note err' }, e.message || String(e)),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: openSettings }, 'Connection settings'),
          h('button', { class: 'btn ghost', onclick: () => showWorkshop(sid, true) }, 'Try again')))));
    }
  }

  function paint() {
    $('#app').replaceChildren(h('div', { class: 'wrap' }, strip(), banner(), W.sid ? sessionView() : homeView()));
    updateBanner();
  }

  function strip() {
    const spent = W.usage.spent_usd || 0, budget = W.usage.budget_usd || W.cfg.caps.monthly_budget_usd;
    const pct = Math.min(100, (spent / budget) * 100);
    return h('div', { class: 'strip' },
      h('div', { class: 'meter' },
        h('div', { class: 'meter-top' }, h('span', null, 'Estimated spend this month'), h('span', null, `${money(spent)} of ${money(budget)}`)),
        h('div', { class: 'meter-bar', role: 'img', 'aria-label': `${Math.round(pct)}% of the monthly budget used` },
          h('i', { class: pct > 80 ? 'hot' : '', style: `width:${pct}%` }))),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: W.dry, onchange: (e) => { W.dry = e.target.checked; } }),
        'Test mode (fake results, no spend)'),
      h('button', { class: 'btn ghost', onclick: openSettings }, 'Connection'));
  }

  function banner() { return h('div', { class: 'banner', id: 'banner', role: 'status', hidden: true }); }
  function updateBanner() {
    const el = $('#banner');
    if (!el) return;
    const b = W.banner;
    if (!b) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'banner ' + (b.kind || '');
    el.replaceChildren(...[
      b.kind === 'busy' ? h('span', { class: 'spin' }) : null,
      h('span', null, b.text),
      b.link ? h('a', { href: b.link, target: '_blank', rel: 'noopener' }, 'View run') : null,
    ].filter(Boolean));
  }
  function setBanner(kind, text, link) { W.banner = text ? { kind, text, link } : null; updateBanner(); }
  function setBusy(b) {
    W.busy = b;
    $$('#app .act').forEach((el) => { el.disabled = b || el.dataset.off === '1'; });
  }

  /* ---- running a pipeline step through GitHub Actions ---- */
  async function listRuns() {
    const res = await api(`/repos/${S.repo}/actions/workflows/dnd.yml/runs?event=workflow_dispatch&per_page=15`);
    if (!res.ok) throw new Error(`Could not read workflow runs (HTTP ${res.status}).`);
    return (await res.json()).workflow_runs || [];
  }

  async function runStep(step, sid, payload, label) {
    if (W.busy) return false;
    setBusy(true);
    setBanner('busy', `${label}: sending to GitHub…`);
    try {
      const before = new Set((await listRuns()).map((r) => r.id));
      const res = await api(`/repos/${S.repo}/actions/workflows/dnd.yml/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: S.branch, inputs: { step, session_id: sid, payload: JSON.stringify(payload), dry_run: String(!!W.dry) } }),
      });
      if (res.status !== 204) {
        const why = { 401: 'The token was rejected.', 403: 'The token cannot run workflows (needs Actions: Read and write).',
                      404: 'Workflow not found, or the token has no access to this repository.', 422: 'GitHub refused the request (is the workflow on the default branch?).' }[res.status];
        throw new Error(why || `GitHub returned HTTP ${res.status}.`);
      }
      const t0 = Date.now();
      let run = null;
      while (Date.now() - t0 < 15 * 60 * 1000) {
        await sleep(4000);
        const runs = await listRuns();
        run = runs.find((r) => !before.has(r.id) && (r.display_title || r.name || '').startsWith(step) && (r.display_title || r.name || '').includes(sid)) || null;
        const secs = Math.round((Date.now() - t0) / 1000);
        if (!run) {
          if (secs > 120) throw new Error('The workflow run did not appear. Check the Actions tab of the repository.');
          setBanner('busy', `${label}: waiting for GitHub to start… (${secs}s)`);
          continue;
        }
        if (run.status === 'completed') break;
        setBanner('busy', `${label}: running… (${secs}s)`, run.html_url);
      }
      if (!run || run.status !== 'completed') throw new Error('Timed out waiting for the run. It may still finish; check the Actions tab.');
      if (run.conclusion === 'success') {
        setBanner('ok', `${label}: done.`);
        setBusy(false);
        if (step === 'delete') location.hash = '#/workshop';
        else if (step !== 'parse') await showWorkshop(sid, true);   // a new session loads via the hash change
        return true;
      }
      let msg = 'The run failed. Open the run log for details.';
      try { const e = await repoJson(`${P.base}docs/data/errors/${sid}.json`); if (e && e.message) msg = e.message; } catch { /* keep generic */ }
      setBanner('err', `${label} failed: ${msg}`, run.html_url);
      setBusy(false);
      return false;
    } catch (e) {
      setBanner('err', `${label} failed: ${e.message || e}`);
      setBusy(false);
      return false;
    }
  }

  /* ---- home view ---- */
  function homeView() {
    const max = W.cfg.caps.max_writeup_chars;
    const title = h('input', { type: 'text', id: 'f-title', maxlength: '100', placeholder: 'e.g. The Siege of Karrowmere' });
    const date = h('input', { type: 'date', id: 'f-date', value: new Date().toISOString().slice(0, 10) });
    const text = h('textarea', { id: 'f-text', rows: '12', placeholder: 'Paste the session write-up here…', style: 'min-height:220px' });
    const counter = h('div', { class: 'counter' }, `0 / ${max}`);
    text.addEventListener('input', () => {
      counter.textContent = `${text.value.length} / ${max}`;
      counter.classList.toggle('over', text.value.length > max);
    });
    const go = h('button', { class: 'btn primary act', onclick: async () => {
      const t = title.value.trim(), w = text.value.trim();
      if (!t) { setBanner('err', 'Give the session a title.'); return; }
      if (w.length < 200) { setBanner('err', 'The write-up needs at least 200 characters.'); return; }
      if (w.length > max) { setBanner('err', `The write-up is over the ${max} character limit.`); return; }
      const sid = `${date.value || new Date().toISOString().slice(0, 10)}-${slug(t)}-${Math.random().toString(36).slice(2, 6)}`;
      const ok = await runStep('parse', sid, { title: t, date: date.value, writeup: w }, 'Finding scenes');
      if (ok) location.hash = `#/workshop/${sid}`;
    } }, `Find ${W.cfg.caps.max_scenes} scenes`);
    const sessions = W.index.sessions;
    return h('div', null,
      h('div', { class: 'panel' },
        h('h1', null, 'New session'),
        h('p', { class: 'muted' }, 'Paste a write-up. Claude picks the most picturesque moments; you choose and refine them before any image is made.'),
        h('div', { class: 'two' }, h('label', null, 'Title', title), h('label', null, 'Session date', date)),
        h('label', null, 'Write-up', text), counter,
        h('div', { class: 'row' }, go, h('span', { class: 'muted small' }, 'Costs a few cents. No images are made yet.'))),
      sessions.length ? h('div', { class: 'panel' }, h('h2', null, 'Sessions'),
        h('div', { class: 'list' }, sessions.map((s) => h('a', { href: `#/workshop/${s.id}` },
          h('span', null, h('b', null, s.title), ' ', h('span', { class: 'muted small' }, s.date)),
          h('span', { class: 'chip ' + (s.count ? 'gold' : '') }, s.count ? `${s.count} images` : s.status))))) : null,
      charsPanel());
  }

  function charsPanel() {
    const dir = `${P.base}characters/`;
    const label = (f) => f.replace(/\.[^.]+$/, '').replace(/-\d+$/, '').replace(/[-_]+/g, ' ');
    const tiles = W.chars.map((f) => {
      const img = h('img', { alt: label(f), loading: 'lazy', style: 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:var(--card2)' });
      repoImage(dir + f).then((u) => { img.src = u; }).catch(() => {});
      return h('figure', { style: 'margin:0' }, img,
        h('figcaption', { class: 'muted small', style: 'text-align:center;text-transform:capitalize' }, label(f)));
    });
    const off = W.cfg.use_references === false;
    return h('div', { class: 'panel' }, h('h2', null, 'Character references'),
      h('p', { class: 'muted' }, 'Pictures in the characters folder are sent to the image model with any scene that features that character, '
        + 'to keep them looking the same. Name each file after the character, for example thorn.png or brother-alden.jpg. '
        + 'The workshop cannot upload files: add them on GitHub (Add file, then Upload files) in ', h('code', null, dir), '.'),
      off ? h('p', { class: 'note err' }, 'Reference images are switched off in config.json (use_references).') : null,
      W.chars.length ? h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px' }, tiles)
        : h('p', { class: 'note' }, 'No reference images yet. Images are made from the written descriptions alone.'));
  }

  /* ---- session view ---- */
  function sessionView() {
    const s = W.session;
    const stepBtn = (key, n, label, enabled) => h('button', {
      'aria-current': W.stage === key ? 'step' : null, disabled: !enabled,
      onclick: () => { W.stage = key; paint(); },
    }, h('b', null, n), label);
    return h('div', null,
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' },
        h('div', null, h('h1', { style: 'margin:0' }, s.title), h('span', { class: 'muted small' }, s.date)),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost act', id: 'rename-btn', onclick: () => { const f = $('#rename-form'); f.hidden = !f.hidden; } }, 'Rename'),
          s.images.length ? h('a', { class: 'btn', href: `#/s/${s.id}`, style: 'text-decoration:none' }, 'View slideshow') : null,
          h('a', { class: 'btn ghost', href: '#/workshop', style: 'text-decoration:none' }, 'All sessions'))),
      renameForm(),
      h('div', { class: 'steps' },
        stepBtn('scenes', 1, 'Scenes', true),
        stepBtn('prompts', 2, 'Prompts', s.prompts.length > 0),
        stepBtn('images', 3, 'Images', s.images.length > 0),
        stepBtn('writeup', 4, 'Write-up', true)),
      W.stage === 'scenes' ? scenesStage() : W.stage === 'prompts' ? promptsStage() : W.stage === 'writeup' ? writeupStage() : imagesStage(),
      h('div', { class: 'panel danger-zone' },
        h('h2', null, 'Delete this session'),
        h('p', { class: 'muted' }, 'Removes the session, all of its images and the stored write-up from the repository, and from the public slideshow. This cannot be undone.'),
        h('button', { class: 'btn danger act', onclick: async () => {
          if (!confirm(`Delete "${s.title}" and all of its images? This cannot be undone.`)) return;
          await runStep('delete', s.id, { confirm: true }, 'Deleting session');
        } }, 'Delete session')));
  }

  function renameForm() {
    const s = W.session;
    const title = h('input', { type: 'text', maxlength: '100', value: s.title, 'aria-label': 'Session title' });
    const date = h('input', { type: 'date', value: s.date, 'aria-label': 'Session date' });
    return h('form', { class: 'panel', id: 'rename-form', hidden: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!title.value.trim()) { setBanner('err', 'The title can\'t be empty.'); return; }
      await runStep('edit', s.id, { title: title.value.trim(), date: date.value }, 'Saving details');
    } },
      h('div', { class: 'two' }, h('label', null, 'Title', title), h('label', null, 'Session date', date)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary act', type: 'submit' }, 'Save'),
        h('span', { class: 'muted small' }, 'The web address of the session stays the same, so existing links keep working.')));
  }

  function scenesStage() {
    const s = W.session, max = W.cfg.caps.max_images_per_run;
    const cards = s.scenes.map((sc) => {
      const pick = h('input', { type: 'checkbox', 'aria-label': `Use scene ${sc.title}`, checked: W.selected.has(sc.id),
        onchange: (e) => { e.target.checked ? W.selected.add(sc.id) : W.selected.delete(sc.id); card.classList.toggle('picked', e.target.checked); sync(); } });
      const note = h('textarea', { rows: '2', maxlength: String(W.cfg.caps.max_note_chars), placeholder: 'Refine: e.g. “make it raining”, “focus on the rogue”…' });
      const reroll = h('input', { type: 'checkbox' });
      const card = h('div', { class: 'scene' + (W.selected.has(sc.id) ? ' picked' : ''), 'data-id': sc.id },
        h('div', { class: 'scene-head' }, pick,
          h('div', null, h('h3', null, sc.title), h('p', null, sc.moment))),
        h('p', { class: 'muted small' }, sc.setting),
        h('div', { class: 'chips' }, sc.characters.map((c) => h('span', { class: 'chip' }, c)), sc.mood ? h('span', { class: 'chip gold' }, sc.mood) : null),
        h('div', { class: 'scene-tools' },
          h('label', { class: 'grow' }, 'Notes for Claude', note),
          h('label', { class: 'check' }, reroll, 'Replace with a different moment')));
      card._note = note; card._reroll = reroll;
      return card;
    });
    const refineBtn = h('button', { class: 'btn act', onclick: async () => {
      const notes = {}, reroll = [];
      cards.forEach((c) => { const n = c._note.value.trim(); if (n) notes[c.dataset.id] = n; if (c._reroll.checked) reroll.push(c.dataset.id); });
      if (!Object.keys(notes).length && !reroll.length) { setBanner('err', 'Add a note to a scene, or tick “Replace” on one, then refine.'); return; }
      await runStep('refine', s.id, { notes, reroll }, 'Refining scenes');
    } }, 'Refine marked scenes');
    const nextBtn = h('button', { class: 'btn primary act', onclick: async () => {
      const ids = s.scenes.map((x) => x.id).filter((id) => W.selected.has(id));
      if (!ids.length) { setBanner('err', 'Choose at least one scene.'); return; }
      if (ids.length > max) { setBanner('err', `Choose at most ${max} scenes per run.`); return; }
      const ok = await runStep('prompts', s.id, { selected: ids }, 'Writing prompts');
      if (ok) { W.stage = 'prompts'; paint(); }
    } });
    const hint = h('span', { class: 'muted small' });
    function sync() {
      const n = W.selected.size;
      nextBtn.textContent = `Write prompts for ${n} scene${n === 1 ? '' : 's'} →`;
      hint.textContent = n > max ? `Over the limit of ${max} per run.` : '';
    }
    sync();
    return h('div', { class: 'panel' },
      h('h2', null, 'Choose and refine the scenes'),
      h('p', { class: 'muted' }, `Tick the moments you want illustrated (up to ${max}). Add notes or ask for a replacement, then refine. Refining costs a cent or two.`),
      cards,
      h('div', { class: 'sticky-bar' }, h('div', { class: 'row' }, refineBtn, hint), nextBtn));
  }

  function promptsStage() {
    const s = W.session, cap = W.cfg.caps.max_prompt_chars, room = W.cfg.caps.max_images_per_session - s.images.length;
    const items = s.prompts.map((p) => {
      const cap_ = h('input', { type: 'text', maxlength: '200', value: p.caption || '' });
      const ta = h('textarea', { rows: '7', maxlength: String(cap), value: p.prompt });
      const count = h('div', { class: 'counter' }, `${p.prompt.length} / ${cap}`);
      ta.addEventListener('input', () => { count.textContent = `${ta.value.length} / ${cap}`; });
      const scene = s.scenes.find((x) => x.id === p.scene_id);
      const refBoxes = (p.references || []).map((f) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: true, 'data-file': f }), h('span', null, f)));
      const card = h('div', { class: 'scene' }, h('h3', null, scene ? scene.title : 'Image'),
        h('label', null, 'Slideshow caption', cap_), h('label', null, 'Image prompt', ta), count,
        refBoxes.length ? h('div', null,
          h('div', { class: 'muted small', style: 'margin-bottom:6px' }, 'Reference pictures sent with this prompt (each adds a little to the cost):'),
          h('div', { class: 'row' }, refBoxes)) : null);
      card._get = () => ({ scene_id: p.scene_id, caption: cap_.value.trim(), prompt: ta.value.trim(),
        references: $$('input[data-file]', card).filter((b) => b.checked).map((b) => b.dataset.file) });
      return card;
    });
    const total = s.prompts.reduce((n, p) => n + imgCost() + refCost() * (p.references || []).length, 0);
    const gen = h('button', { class: 'btn primary act', onclick: async () => {
      const prompts = items.map((c) => c._get()).filter((p) => p.prompt);
      if (!prompts.length) { setBanner('err', 'There is nothing to generate.'); return; }
      if (prompts.length > room) { setBanner('err', `Only ${room} more image(s) fit in this session. Remove some first.`); return; }
      const ok = await runStep('generate', s.id, { prompts }, `Generating ${prompts.length} image${prompts.length === 1 ? '' : 's'}`);
      if (ok) { W.stage = 'images'; paint(); }
    } }, `Generate ${items.length} image${items.length === 1 ? '' : 's'} (about ${money(total)})`);
    return h('div', { class: 'panel' },
      h('h2', null, 'Edit the prompts'),
      h('p', { class: 'muted' }, 'These are sent to the image model exactly as written, so change anything you like. Characters and style come from style-guide.md in the repository.'),
      items,
      h('div', { class: 'sticky-bar' },
        h('button', { class: 'btn ghost act', onclick: () => { W.stage = 'scenes'; paint(); } }, '← Back to scenes'), gen));
  }

  function imagesStage() {
    const s = W.session;
    const picks = new Set();
    const items = s.images.map((im) => ({ name: im.file.split('/').pop(), file: im.file, caption: im.caption || '',
      scene_id: im.scene_id || '', prompt: im.prompt || '', refs: [...(im.references || [])], open: false }));
    const orig = JSON.stringify(items.map((i) => [i.name, i.caption]));
    const grid = h('div', { class: 'imgs' });
    const removeBtn = h('button', { class: 'btn act', 'data-off': '1', disabled: true, onclick: async () => {
      if (!picks.size) return;
      if (!confirm(`Remove ${picks.size} image(s) from this session? This deletes the files.`)) return;
      await runStep('remove', s.id, { files: [...picks] }, 'Removing images');
    } }, 'Remove selected');
    const saveBtn = h('button', { class: 'btn primary act', 'data-off': '1', disabled: true, onclick: async () => {
      const captions = {};
      items.forEach((i) => { captions[i.name] = i.caption; });
      await runStep('edit', s.id, { captions, order: items.map((i) => i.name) }, 'Saving captions and order');
    } }, 'Save captions & order');
    const isDirty = () => JSON.stringify(items.map((i) => [i.name, i.caption])) !== orig;
    function promptEditor(it) {
      const cap = W.cfg.caps.max_prompt_chars;
      const ta = h('textarea', { rows: '8', maxlength: String(cap), value: it.prompt, 'aria-label': 'Image prompt' });
      const count = h('div', { class: 'counter' }, `${it.prompt.length} / ${cap}`);
      ta.addEventListener('input', () => { it.prompt = ta.value; count.textContent = `${ta.value.length} / ${cap}`; });
      const files = [...new Set([...W.chars, ...it.refs])];
      const refBoxes = files.map((f) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: it.refs.includes(f),
          onchange: (e) => { it.refs = e.target.checked ? [...it.refs, f] : it.refs.filter((x) => x !== f); } }), h('span', null, f)));
      const guard = () => {
        if (isDirty()) { setBanner('err', 'Save your caption and order changes first, then edit the prompt.'); return false; }
        if (!it.prompt.trim()) { setBanner('err', 'The prompt can\'t be empty.'); return false; }
        return true;
      };
      const cost = imgCost() + refCost() * it.refs.length;
      return h('div', { class: 'redo' },
        h('label', null, 'Prompt used for this image', ta), count,
        refBoxes.length ? h('div', null, h('div', { class: 'muted small', style: 'margin:6px 0' }, 'Reference pictures to send:'), h('div', { class: 'row' }, refBoxes)) : null,
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'btn act', type: 'button', onclick: async () => {
            if (!guard()) return;
            await runStep('edit', s.id, { image_prompts: { [it.name]: it.prompt.trim() } }, 'Saving prompt');
          } }, 'Save prompt only'),
          h('button', { class: 'btn primary act', type: 'button', onclick: async () => {
            if (!guard()) return;
            if (!confirm(`Make a new picture from this prompt and replace this one? It costs about ${money(cost)}.`)) return;
            await runStep('generate', s.id, { prompts: [{ scene_id: it.scene_id, caption: it.caption.trim(), prompt: it.prompt.trim(),
              references: it.refs, replaces: it.name }] }, 'Redoing image');
          } }, `Redo this image (about ${money(cost)})`)),
        h('p', { class: 'muted small' }, 'Redo swaps the new picture into the same place in the slideshow and deletes the old one.'));
    }
    function dirty() {
      const d = JSON.stringify(items.map((i) => [i.name, i.caption])) !== orig;
      saveBtn.dataset.off = d ? '0' : '1'; saveBtn.disabled = W.busy || !d;
    }
    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      draw(); dirty();
    }
    function draw() {
      grid.replaceChildren(...items.map((it, i) => {
        const img = h('img', { alt: it.caption || 'Generated image', loading: 'lazy' });
        repoImage(P.base + 'docs/' + it.file).then((u) => { img.src = u; }).catch(() => { img.src = it.file; });
        const cap = h('input', { type: 'text', maxlength: '200', value: it.caption, placeholder: 'Caption', 'aria-label': `Caption for image ${i + 1}`,
          oninput: (e) => { it.caption = e.target.value; dirty(); } });
        return h('figure', { class: 'img', style: 'margin:0' }, img,
          h('label', { class: 'check pick' }, h('input', { type: 'checkbox', 'aria-label': `Select image ${i + 1}`, checked: picks.has(it.name),
            onchange: (e) => { e.target.checked ? picks.add(it.name) : picks.delete(it.name);
              removeBtn.dataset.off = picks.size ? '0' : '1'; removeBtn.disabled = W.busy || !picks.size; } }), 'Select'),
          h('figcaption', null, cap,
            h('button', { class: 'btn ghost small', type: 'button', 'aria-expanded': it.open ? 'true' : 'false',
              onclick: () => { it.open = !it.open; draw(); } }, it.open ? 'Hide prompt' : 'Prompt & redo'),
            it.open ? promptEditor(it) : null,
            h('div', { class: 'row mover' },
              h('button', { class: 'btn ghost small', type: 'button', disabled: i === 0, 'aria-label': 'Move earlier', onclick: () => move(i, -1) }, '←'),
              h('span', { class: 'muted small' }, `${i + 1} of ${items.length}`),
              h('button', { class: 'btn ghost small', type: 'button', disabled: i === items.length - 1, 'aria-label': 'Move later', onclick: () => move(i, 1) }, '→'))));
      }));
    }
    draw();
    return h('div', { class: 'panel' },
      h('h2', null, 'Images'),
      h('p', { class: 'muted' }, 'Edit captions and reorder, then save. The first image is the session\'s cover. The public slideshow updates about a minute after each change. Open "Prompt & redo" on any image to see the prompt it was made from, tweak it, and replace just that picture.'),
      grid,
      h('div', { class: 'sticky-bar' }, h('div', { class: 'row' }, saveBtn, removeBtn),
        h('button', { class: 'btn act', 'data-off': s.prompts.length ? null : '1', onclick: () => { W.stage = 'prompts'; paint(); }, disabled: !s.prompts.length }, 'Edit prompts / make more')));
  }

  function writeupStage() {
    const s = W.session, max = W.cfg.caps.max_writeup_chars;
    const panel = h('div', { class: 'panel' }, h('h2', null, 'Write-up'),
      h('p', { class: 'muted' }, 'Loading the stored write-up…'));
    repoText(`${P.base}docs/data/sessions/${s.id}/writeup.md`).then((t) => t ?? repoText(`${P.base}sessions/${s.id}/writeup.md`)).then((text) => {
      const ta = h('textarea', { rows: '16', style: 'min-height:260px', maxlength: String(max), value: (text || '').trim(), 'aria-label': 'Session write-up' });
      const count = h('div', { class: 'counter' }, '');
      const orig = ta.value;
      const pub = h('input', { type: 'checkbox', id: 'wu-public', checked: s.writeup_public === true });
      const save = h('button', { class: 'btn primary act', 'data-off': '1', disabled: true, onclick: async () => {
        const t = ta.value.trim();
        if (t.length < 200) { setBanner('err', 'The write-up needs at least 200 characters.'); return; }
        await runStep('writeup', s.id, { text: t, public: pub.checked }, 'Saving write-up');
      } }, 'Save write-up');
      const sync = () => {
        count.textContent = `${ta.value.length} / ${max}`; count.classList.toggle('over', ta.value.length > max);
        const ok = (ta.value !== orig || pub.checked !== (s.writeup_public === true)) && ta.value.length <= max;
        save.dataset.off = ok ? '0' : '1'; save.disabled = W.busy || !ok;
      };
      ta.addEventListener('input', sync); pub.addEventListener('change', sync); sync();
      panel.replaceChildren(h('h2', null, 'Write-up'),
        h('p', { class: 'muted' }, 'The original text this session was made from. Editing it is free and does not change the scenes or images already made. It is used the next time you refine scenes. '
          + 'It stays private in the studio repository unless you tick the box below.'),
        h('label', null, 'Write-up text', ta), count,
        h('label', { class: 'check', style: 'margin:0 0 6px' }, pub, 'Show this write-up in the public gallery (a "Story" button in the slideshow)'),
        h('p', { class: 'muted small' }, 'Once published it stays in the public repository\'s history, even if you untick this later.'),
        h('div', { class: 'sticky-bar' }, save));
    }).catch(() => {
      panel.replaceChildren(h('h2', null, 'Write-up'), h('p', { class: 'note err' }, 'The stored write-up could not be loaded.'));
    });
    return panel;
  }

  /* ------------------------------------------------------------ router */
  let lastKey = null;
  function route(force) {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 's' && parts[1]) {
      teardownViewer();
      showGallery().then(() => openViewer(parts[1], (parseInt(parts[2], 10) || 1) - 1));
      return;
    }
    teardownViewer();
    if (parts[0] === 'workshop') {
      const key = 'w/' + (parts[1] || '');
      if (!force && key === lastKey) return;
      lastKey = key;
      showWorkshop(parts[1] || null, !!force);
    } else {
      lastKey = 'g';
      showGallery();
    }
  }

  window.addEventListener('hashchange', () => route(false));
  wireSettings();
  loadSite().then(() => route(true));
})();
