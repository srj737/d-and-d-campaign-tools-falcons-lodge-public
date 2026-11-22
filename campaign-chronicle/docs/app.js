/* Campaign Chronicle: gallery, slideshow and workshop. No build step, no dependencies. */
(() => {
  'use strict';

  /* ------------------------------------------------------------ utilities */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  /* "2026-11-21" -> "21 November 2026" (falls back to the raw text) */
  const fmtDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    try { return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
    catch { return String(iso); }
  };
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
  async function repoDir(path) {                     // one listing of a folder: the names of its files
    const res = await api(`/repos/${S.repo}/contents/${path}?ref=${encodeURIComponent(S.branch)}`);
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? j.filter((f) => f.type === 'file').map((f) => f.name) : [];
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
  /* start fetching the list straight away, in parallel with site.json, instead of after it */
  let indexReady = getJson('data/index.json');
  indexReady.catch(() => {});

  async function showGallery() {
    setNav('gallery');
    if (galleryShown) return;
    const app = $('#app');
    app.replaceChildren(h('div', { class: 'wrap' }, h('p', { class: 'muted' }, 'Unrolling the scrolls…')));
    let list = [];
    try { const got = indexReady || getJson('data/index.json'); indexReady = null;      // the head start is used once; later visits fetch fresh
      list = (await got).sessions.filter((s) => s.count > 0); }
    catch { /* shows empty state */ }
    const grid = list.length
      ? h('div', { class: 'grid' }, list.map((s) =>
        h('a', { class: 'sess', href: `#/s/${s.id}` },
          s.cover ? h('img', { src: s.thumb || s.cover, alt: '', loading: 'lazy', decoding: 'async', width: '640', height: '427' }) : null,
          h('span', { class: 'badge' }, `✦ ${s.count} ${s.count === 1 ? 'scene' : 'scenes'}`),
          h('div', { class: 'sess-meta' }, h('h3', null, s.title), h('span', { class: 'sess-date' }, fmtDate(s.date))))))
      : h('div', { class: 'empty' },
        h('p', null, 'The scrolls are still blank. No tales have been illustrated yet.'),
        h('a', { href: '#/workshop' }, 'Visit the workshop to conjure the first one'));
    app.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'hero' }, h('h1', null, 'The Chronicle'),
        h('p', null, 'Pick a tale to relive it as a slideshow.'),
        h('div', { class: 'flourish', 'aria-hidden': 'true' }, h('span', null, '✦'))),
      grid,
      h('p', { class: 'gallery-foot' }, 'Told from memory, as the best tales are. Details of events may differ from how they truly unfolded.')));
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
        h('h2', null, session.title, session.date ? h('span', { class: 'v-date' }, fmtDate(session.date)) : null),
        h('span', { class: 'v-count', id: 'v-count', 'aria-live': 'polite' }),
        h('button', { class: 'btn ghost small', id: 'v-story-btn', hidden: true, 'aria-expanded': 'false', title: 'Read the write-up (r)', onclick: toggleStory }, 'Story'),
        h('button', { class: 'icon-btn', id: 'v-play', 'aria-label': 'Autoplay', 'aria-pressed': 'false', title: 'Autoplay (space)', onclick: toggleAuto }, '▶'),
        h('button', { class: 'icon-btn', 'aria-label': 'Full screen', title: 'Full screen (f)', onclick: toggleFull }, '⛶'),
        h('button', { class: 'icon-btn', id: 'v-close', 'aria-label': 'Close slideshow', title: 'Close (esc)', onclick: closeViewer }, '✕')),
      h('div', { class: 'v-stage', id: 'v-stage' },
        h('img', { id: 'v-img', alt: '' }),
        h('p', { class: 'v-err', id: 'v-err', hidden: true, role: 'status' }, 'This picture could not be loaded. Check your connection, then press the arrow or reload the page.'),
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
    const el = $('#v-img'), err = $('#v-err');
    /* Only swap the picture in once the new one has really loaded. Until then the stage is blank (never the previous
       picture under the new caption), and a picture that fails to load says so instead of silently showing the old one. */
    const token = V.token = (V.token || 0) + 1;
    el.classList.add('fade');
    err.hidden = true;
    const loaded = new Promise((ok, no) => { const t = new Image(); t.onload = ok; t.onerror = no; t.src = im.file; });
    Promise.all([loaded, sleep(instant ? 0 : 220)]).then(() => {
      if (token !== V.token || !V.open) return;
      el.src = im.file;
      el.alt = im.caption || V.session.title;
      el.classList.remove('fade');
    }).catch(() => {
      if (token !== V.token || !V.open) return;
      el.removeAttribute('src');
      el.alt = '';
      err.hidden = false;
    });
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
  const W = { cfg: null, usage: null, index: null, refs: [], sid: null, session: null, stage: 'scenes',
              selected: new Set(), busy: false, banner: null, dry: false, loadedFor: null, view: null };

  const imgCost = () => W.cfg.prices.image_usd[W.cfg.image_quality] || 0.1;
  const refCost = () => W.cfg.prices.reference_image_usd || 0;

  /* reference pictures live in references/<folder>/<name>.png; the ids used everywhere are "folder/name.png" */
  const refFolders = (cfg) => cfg.reference_folders || { 'player-characters': 'player character', npcs: 'NPC' };
  const dropRefPictures = () => { for (const k of [...blobUrls.keys()]) if (k.startsWith(`${P.base}references/`)) { URL.revokeObjectURL(blobUrls.get(k)); blobUrls.delete(k); } };
  async function listRefs(cfg) {
    /* already-downloaded pictures are kept (dropRefPictures runs after a reference change), so reopening the Workshop is quick */
    const folders = Object.keys(refFolders(cfg));
    const dirs = await Promise.all(folders.map((f) => repoDir(`${P.base}references/${f}`).catch(() => [])));
    const lists = dirs.map((names, i) => names.filter((n) => /\.(png|jpe?g|webp)$/i.test(n)).map((n) => `${folders[i]}/${n}`));
    /* descriptions: references/<folder>/<subject>.md, one per subject, shared by all its pictures */
    const mds = dirs.flatMap((names, i) => names.filter((n) => /\.md$/i.test(n)).map((n) => `${folders[i]}/${n}`));
    W.descs = {};
    await Promise.all(mds.map(async (id) => { W.descs[id] = ((await repoText(`${P.base}references/${id}`).catch(() => '')) || '').trim(); }));
    return lists.flat();
  }
  const subjectBase = (id) => id.split('/').pop().replace(/\.[^.]+$/, '').replace(/-\d+$/, '');
  const descFor = (folder, base) => W.descs && W.descs[`${folder}/${base}.md`] || '';
  /* Shrink a picture in the browser so it fits in a workflow input (about 40 KB). The token cannot write to the repo,
     so the picture travels inside the run request; bigger originals can still be added on GitHub. */
  const blobToB64 = (blob) => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => no(new Error('Could not read the picture.'));
    r.readAsDataURL(blob);
  });
  async function shrinkImage(file, limit = 52000) {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { throw new Error('That file is not a picture this browser can read.'); }
    for (const maxDim of [768, 640, 512, 448, 384, 320, 256]) {
      const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh); g.drawImage(bmp, 0, 0, w, hh);
      for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
        const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));
        const data = blob ? await blobToB64(blob) : '';
        if (data && data.length <= limit) return { data, w, h: hh, kb: Math.max(1, Math.round(blob.size / 1024)) };
      }
    }
    throw new Error('That picture is too detailed to shrink enough. Try a simpler or smaller one, or add it on GitHub.');
  }
  const refSlug = (t) => String(t).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  const refName = (id) => id.split('/').pop().replace(/\.[^.]+$/, '').replace(/-\d+$/, '').replace(/[-_]+/g, ' ');
  const refKind = (id) => refFolders(W.cfg)[id.split('/')[0]] || id.split('/')[0];

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
      const [cfg, usage, index] = await Promise.all([
        repoJson(P.base + 'config.json'), repoJson(P.base + 'docs/data/usage.json'), repoJson(P.base + 'docs/data/index.json')]);
      if (!cfg) throw new Error('config.json was not found in the repository.');
      W.cfg = cfg; W.usage = usage || { spent_usd: 0, budget_usd: cfg.caps.monthly_budget_usd };
      W.index = index || { sessions: [] };
      W.refs = await listRefs(cfg);
      if (sid) {
        const knownIds = new Set(W.loadedFor === sid && W.session ? W.session.scenes.map((x) => x.id) : []);
        W.session = await repoJson(`${P.base}docs/data/sessions/${sid}/session.json`);
        if (!W.session) throw new Error('That session was not found.');
        if (W.loadedFor === sid) {                      // scenes you just added come ticked; keep your other ticks as they are
          const fresh = W.session.scenes.filter((x) => !knownIds.has(x.id));
          if (fresh.length && (W.session.images || []).length) {
            // you added a moment to a session that already has pictures: tick just the new one, so the existing pictures stay as they are
            W.selected = new Set(fresh.map((x) => x.id));
          } else fresh.forEach((x) => W.selected.add(x.id));
          for (const id of [...W.selected]) if (!W.session.scenes.some((x) => x.id === id)) W.selected.delete(id);
        }
        if (W.loadedFor !== sid) {
          W.view = null;
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

  const PAID_STEPS = new Set(['parse', 'refine', 'prompts', 'generate']);
  let unsure = null;   // a paid run that may still be going after the page lost contact with GitHub
  async function runStep(step, sid, payload, label) {
    if (W.busy) return false;
    if (unsure && PAID_STEPS.has(step) && PAID_STEPS.has(unsure.step) && unsure.sid === sid && Date.now() - unsure.at < 20 * 60 * 1000
        && !confirm('A earlier request for this session may still be running on GitHub (this page lost contact with it). '
          + 'Starting another could charge you twice. Reload the page first to see whether it finished.\n\nStart another anyway?')) return false;
    setBusy(true);
    setBanner('busy', `${label}: sending to GitHub…`);
    let sent = false;
    try {
      const before = new Set((await listRuns()).map((r) => r.id));
      sent = true;   // from here on the request may have reached GitHub even if this page never hears back
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
      let misses = 0;
      while (Date.now() - t0 < 15 * 60 * 1000) {
        await sleep(4000);
        let runs;
        try { runs = await listRuns(); misses = 0; } catch (e) {
          // a brief network drop must not abandon a run that is still going on GitHub's side
          if (++misses > 10) throw new Error('Lost contact with GitHub. The run may still be going: reload the page in a minute and check before starting it again.');
          setBanner('busy', `${label}: connection hiccup, retrying… (${misses})`);
          continue;
        }
        run = runs.find((r) => !before.has(r.id) && (r.display_title || r.name || '').startsWith(step + ' ') && (r.display_title || r.name || '').includes(sid)) || null;
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
        unsure = null;
        setBanner('ok', `${label}: done.`);
        setBusy(false);
        if (step === 'delete') location.hash = '#/workshop';
        else if (step === 'reference' || step === 'reorder') { if (step === 'reference') dropRefPictures(); await showWorkshop(null, true); }
        else if (step !== 'parse') await showWorkshop(sid, true);   // a new session loads via the hash change
        return true;
      }
      let msg = 'The run failed. Open the run log for details.';
      try { const e = await repoJson(`${P.base}docs/data/errors/${sid}.json`); if (e && e.message) msg = e.message; } catch { /* keep generic */ }
      setBanner('err', `${label} failed: ${msg}`, run.html_url);
      setBusy(false);
      return false;
    } catch (e) {
      const lost = sent && /failed to fetch|networkerror|load failed|lost contact/i.test(String(e.message || e));
      if (lost) unsure = { step, sid, at: Date.now() };
      setBanner('err', lost && !/lost contact/i.test(String(e.message || e))
        ? `${label}: lost contact with GitHub, but the run may still be going. Reload the page in a minute and check before starting it again.`
        : `${label} failed: ${e.message || e}`);
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
      sessions.length ? sessionsPanel(sessions) : null,
      charsPanel());
  }

  /* the sessions list, with arrows to arrange the order the gallery shows them in */
  function sessionsPanel(sessions) {
    const order = sessions.map((x) => x.id);
    const byId = new Map(sessions.map((x) => [x.id, x]));
    const orig = JSON.stringify(order);
    const list = h('div', { class: 'list sortable' });
    const save = h('button', { class: 'btn primary act', id: 'sess-save', type: 'button', 'data-off': '1', disabled: true, onclick: async () => {
      await runStep('reorder', 'sessions', { ids: order }, 'Saving order');
    } }, 'Save order');
    function draw() {
      list.replaceChildren(...order.map((id, i) => {
        const x = byId.get(id);
        return h('div', { class: 'sess-row', 'data-id': id },
          h('a', { href: `#/workshop/${id}` },
            h('span', null, h('b', null, x.title), ' ', h('span', { class: 'muted small' }, fmtDate(x.date))),
            h('span', { class: 'chip ' + (x.count ? 'gold' : '') }, x.count ? `${x.count} images` : x.status)),
          h('span', { class: 'movers' },
            h('button', { class: 'btn ghost small', type: 'button', disabled: i === 0, 'aria-label': `Move ${x.title} earlier`, onclick: () => move(i, -1) }, '↑'),
            h('button', { class: 'btn ghost small', type: 'button', disabled: i === order.length - 1, 'aria-label': `Move ${x.title} later`, onclick: () => move(i, 1) }, '↓')));
      }));
    }
    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      draw();
      const dirty = JSON.stringify(order) !== orig;
      save.dataset.off = dirty ? '0' : '1'; save.disabled = W.busy || !dirty;
    }
    draw();
    return h('div', { class: 'panel' }, h('h2', null, 'Sessions'),
      h('p', { class: 'muted small' }, 'The gallery shows sessions in this order. New sessions start at the top. Use the arrows to rearrange, then save. To change a session\'s date, open it and press "Rename / change date".'),
      list, h('div', { class: 'row', style: 'margin-top:12px' }, save));
  }

  function charsPanel() {
    const dir = `${P.base}references/`;
    const folders = refFolders(W.cfg);
    const sections = Object.entries(folders).map(([folder, kind]) => {
      const ids = W.refs.filter((r) => r.startsWith(folder + '/'));
      const pictured = new Set(ids.map(subjectBase));
      const textOnly = Object.keys(W.descs || {}).filter((d) => d.startsWith(folder + '/') && !pictured.has(subjectBase(d)));
      const textTiles = textOnly.map((id) => h('figure', { class: 'ref-tile text-only', tabindex: '0', role: 'button', 'data-ref': id,
        'aria-label': `Edit ${refName(id)}`, style: 'margin:0;cursor:pointer', onclick: () => selectRef(id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRef(id); } } },
        h('div', { class: 'ref-nopic' }, 'no picture'),
        h('figcaption', { class: 'muted small', style: 'text-align:center;text-transform:capitalize' }, refName(id))));
      const tiles = ids.map((id) => {
        const img = h('img', { alt: refName(id), loading: 'lazy', style: 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:var(--card2)' });
        repoImage(dir + id).then((u) => { img.src = u; }).catch(() => {});
        return h('figure', { class: 'ref-tile', tabindex: '0', role: 'button', 'data-ref': id, 'aria-label': `Edit ${refName(id)}`,
          style: 'margin:0;cursor:pointer', onclick: () => selectRef(id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRef(id); } } }, img,
          h('figcaption', { class: 'muted small', style: 'text-align:center;text-transform:capitalize' }, refName(id)));
      });
      return h('div', { class: 'ref-group', 'data-folder': folder },
        h('h3', { style: 'margin:0 0 8px' }, h('span', { style: 'text-transform:capitalize' }, `${kind}s`), ' ',
          h('span', { class: 'muted small', style: 'font-family:var(--sans);font-weight:400' }, `references/${folder}/`)),
        tiles.length || textTiles.length ? h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px' }, [...tiles, ...textTiles])
          : h('p', { class: 'muted small' }, 'None yet.'));
    });
    const editor = h('div', { class: 'ref-editor', id: 'ref-editor', hidden: true });
    const folderSelect = (value) => h('select', { 'aria-label': 'Folder' }, Object.entries(folders).map(([f, k]) =>
      h('option', Object.assign({ value: f }, f === value ? { selected: true } : {}), `${k}s`)));
    function selectRef(id) {
      $$('.ref-tile', document).forEach((t) => t.classList.toggle('on', t.dataset.ref === id));
      const [folder, file] = id.split('/');
      const stem = file.replace(/\.[^.]+$/, '');
      const isText = /\.md$/i.test(file);
      const base = subjectBase(id);
      const maxDesc = (W.cfg.caps && W.cfg.caps.max_description_chars) || 600;
      const desc = h('textarea', { id: 'ref-desc', rows: '4', maxlength: String(maxDesc), 'aria-label': 'Description',
        placeholder: 'Fixed looks and details, e.g. tall half-orc, braided red beard, scarred left cheek, patched green cloak' });
      desc.value = descFor(folder, base);
      const count = h('span', { class: 'muted small' }, '');
      const upCount = () => { count.textContent = `${desc.value.length}/${maxDesc}`; };
      desc.addEventListener('input', upCount); upCount();
      const saveDesc = h('button', { class: 'btn act', id: 'ref-desc-save', type: 'button', onclick: async () => {
        await runStep('reference', 'references', { action: 'describe', folder, name: base, text: desc.value }, 'Saving description');
      } }, desc.value ? 'Save description' : 'Save description');
      const name = h('input', { type: 'text', value: stem, maxlength: '60', 'aria-label': 'Name' });
      const where = folderSelect(folder);
      const save = h('button', { class: 'btn primary act', type: 'button', onclick: async () => {
        const n = refSlug(name.value);
        if (!n) { setBanner('err', 'Give the picture a name, using letters and numbers.'); return; }
        if (n === stem && where.value === folder) { setBanner('err', 'Change the name or the folder first.'); return; }
        await runStep('reference', 'references', { action: 'move', from: id, folder: where.value, name: n }, 'Saving changes');
      } }, 'Save changes');
      const del = h('button', { class: 'btn danger act', type: 'button', onclick: async () => {
        if (!confirm(isText ? `Delete the description of ${refName(id)}?` : `Delete ${refName(id)} (${refKind(id)}) from the reference pictures? Its description, if any, is kept.`)) return;
        await runStep('reference', 'references', { action: 'delete', file: id }, 'Deleting');
      } }, isText ? 'Delete description' : 'Delete picture');
      editor.hidden = false;
      editor.replaceChildren(h('h3', { style: 'margin:0 0 8px' }, 'Edit ', h('span', { style: 'text-transform:capitalize' }, refName(id))),
        h('div', { class: 'two' }, h('label', null, 'Name', name), h('label', null, 'Folder', where)),
        h('label', null, 'Description ', count, desc),
        h('p', { class: 'muted small' }, 'Used whenever this ', h('b', null, refKind(id)), ' is in a scene: the prompt writer is told to follow it exactly. '
          + 'Shared by every picture of the same name, so thorn and thorn-2 use one description. Leave it empty and save to remove it.'),
        h('div', { class: 'row' }, saveDesc, save, del, h('button', { class: 'btn ghost', type: 'button', onclick: () => {
          editor.hidden = true; $$('.ref-tile', document).forEach((t) => t.classList.remove('on')); } }, 'Close')),
        h('p', { class: 'muted small' }, 'Renaming changes which characters, places or objects it matches. Pictures already used in finished images are unaffected.'));
      editor.scrollIntoView?.({ block: 'nearest' });
    }

    /* add a picture */
    let ready = null;
    const addName = h('input', { type: 'text', id: 'ref-name', maxlength: '60', placeholder: 'e.g. lord-voss', 'aria-label': 'New picture name' });
    const addFolder = folderSelect('player-characters');
    const info = h('p', { class: 'muted small', id: 'ref-info' }, 'Choose a picture. It is shrunk in your browser to fit (about 40 KB); for sharper originals, add them on GitHub instead.');
    const addDesc = h('textarea', { id: 'ref-add-desc', rows: '3', maxlength: String((W.cfg.caps && W.cfg.caps.max_description_chars) || 600),
      'aria-label': 'New description', placeholder: 'Optional. Fixed looks and details. You can add a description without a picture.' });
    const addBtn = h('button', { class: 'btn primary act', id: 'ref-add', type: 'button', onclick: async () => {
      const n = refSlug(addName.value);
      const text = addDesc.value.trim();
      if (!n || (!ready && !text)) { setBanner('err', 'Give it a name, then choose a picture, write a description, or both.'); return; }
      if (!ready) {
        if (descFor(addFolder.value, n.replace(/-\d+$/, '')) && !confirm(`${n} already has a description. Replace it?`)) return;
        await runStep('reference', 'references', { action: 'describe', folder: addFolder.value, name: n, text }, 'Saving description');
        return;
      }
      const exists = W.refs.some((r) => r.startsWith(`${addFolder.value}/${n}.`));
      if (exists && !confirm(`${n} already exists in that folder. Replace it?`)) return;
      await runStep('reference', 'references', { action: 'add', folder: addFolder.value, name: n, data: ready.data, replace: exists, description: text }, 'Adding');
    } }, 'Add');
    const fileIn = h('input', { type: 'file', id: 'ref-file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Picture file',
      onchange: async (e) => {
        ready = null;
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        info.textContent = 'Shrinking…';
        try {
          ready = await shrinkImage(f);
          if (!addName.value.trim()) addName.value = refSlug(f.name);
          info.textContent = `Ready: ${ready.w}×${ready.h} JPEG, ${ready.kb} KB.`;
        } catch (err) { info.textContent = err.message || String(err); }
      } });
    const addForm = h('div', { class: 'ref-add' }, h('h3', { style: 'margin:18px 0 8px' }, 'Add a picture or description'),
      h('div', { class: 'two' }, h('label', null, 'Folder', addFolder), h('label', null, 'Name', addName)),
      h('label', null, 'Picture', fileIn), info, h('label', null, 'Description', addDesc), addBtn);

    const off = W.cfg.use_references === false;
    return h('div', { class: 'panel' }, h('h2', null, 'Reference pictures'),
      h('p', { class: 'muted' }, 'Pictures in these folders are sent to the image model with any scene that features them, '
        + 'to keep characters, places and objects looking the same. Name each file after what it shows, for example '
        + 'thorn or dudgeon-manor. Add, rename, move and delete them here; click a picture to edit it. Pictures added here are shrunk to fit, '
        + 'so for sharper originals use GitHub (Add file, then Upload files) under ', h('code', null, dir), '.'),
      off ? h('p', { class: 'note err' }, 'Reference images are switched off in config.json (use_references).') : null,
      sections, editor, addForm,
      W.refs.length ? null : h('p', { class: 'note' }, 'No reference pictures yet. Until you add some, each image is made from the text prompt alone. Pictures you add here are sent to the image model (OpenAI) together with the prompt, for scenes that feature them.'));
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
          h('button', { class: 'btn ghost act', id: 'rename-btn', onclick: () => { const f = $('#rename-form'); f.hidden = !f.hidden; } }, 'Rename / change date'),
          s.images.length ? h('a', { class: 'btn', href: `#/s/${s.id}`, style: 'text-decoration:none' }, 'View slideshow') : null,
          h('a', { class: 'btn ghost', href: '#/workshop', style: 'text-decoration:none' }, 'All sessions'))),
      renameForm(),
      h('div', { class: 'steps' },
        stepBtn('scenes', 1, 'Scenes', true),
        stepBtn('prompts', 2, 'Prompts', s.prompts.length > 0),
        stepBtn('images', 3, 'Images', s.images.length > 0),
        stepBtn('writeup', 4, 'Write-up', true),
        stepBtn('manage', 5, 'Manage', true)),
      W.stage === 'scenes' ? scenesStage() : W.stage === 'prompts' ? promptsStage() : W.stage === 'writeup' ? writeupStage() : W.stage === 'manage' ? manageStage() : imagesStage());
  }

  function manageStage() {
    const s = W.session;
    return h('div', null,
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
    const pictured = new Set((s.images || []).map((im) => im.scene_id));
    const cards = s.scenes.map((sc) => {
      const pick = h('input', { type: 'checkbox', 'aria-label': `Use scene ${sc.title}`, checked: W.selected.has(sc.id),
        onchange: (e) => { e.target.checked ? W.selected.add(sc.id) : W.selected.delete(sc.id); card.classList.toggle('picked', e.target.checked); sync(); } });
      const note = h('textarea', { rows: '2', maxlength: String(W.cfg.caps.max_note_chars), placeholder: 'Tweak this scene: e.g. “make it raining”, “focus on the rogue”…' });
      const reroll = h('input', { type: 'checkbox' });
      const card = h('div', { class: 'scene' + (W.selected.has(sc.id) ? ' picked' : ''), 'data-id': sc.id },
        h('div', { class: 'scene-head' }, pick,
          h('div', null, h('h3', null, sc.title), h('p', null, sc.moment))),
        h('p', { class: 'muted small' }, sc.setting),
        h('div', { class: 'chips' }, sc.characters.map((c) => h('span', { class: 'chip' }, c)),
          (sc.locations || []).map((c) => h('span', { class: 'chip', title: 'Location' }, '⌂ ' + c)),
          (sc.objects || []).map((c) => h('span', { class: 'chip', title: 'Object' }, '◆ ' + c)), sc.mood ? h('span', { class: 'chip gold' }, sc.mood) : null,
          pictured.has(sc.id) ? h('span', { class: 'chip has-pic', title: 'A picture was already made from this scene' }, '✓ has a picture') : null),
        h('div', { class: 'scene-tools' },
          h('label', { class: 'grow' }, 'Notes for Claude', note),
          h('label', { class: 'check' }, reroll, 'Swap for a different moment (Claude picks)')));
      card._note = note; card._reroll = reroll;
      return card;
    });
    /* "+ Add a moment here": describe your own moment and Claude writes the scene, placed where you clicked */
    const maxTotal = W.cfg.caps.max_scenes_total || 12, maxText = W.cfg.caps.max_note_chars;
    const slot = (after) => {
      const box = h('div', { class: 'add-slot', 'data-after': after || '' });
      const open = h('button', { class: 'btn ghost act add-open', type: 'button', onclick: () => {
        const text = h('textarea', { rows: '3', maxlength: String(maxText), 'aria-label': 'Describe the moment',
          placeholder: 'Describe the moment in your own words, e.g. “Thorn carries the wounded gnome out of the burning chapel”' });
        const go = h('button', { class: 'btn primary act', type: 'button', onclick: async () => {
          const t = text.value.trim();
          if (!t) { setBanner('err', 'Describe the moment first.'); return; }
          const notes = {}, reroll = [];
          cards.forEach((c) => { const n = c._note.value.trim(); if (n) notes[c.dataset.id] = n; if (c._reroll.checked) reroll.push(c.dataset.id); });
          await runStep('refine', s.id, { notes, reroll, add: [{ after: after || '@start', text: t }] }, 'Adding your moment');
        } }, 'Add this moment');
        box.replaceChildren(h('label', null, 'Your moment', text),
          h('div', { class: 'row' }, go, h('button', { class: 'btn ghost', type: 'button', onclick: () => box.replaceChildren(open) }, 'Cancel'),
            h('span', { class: 'muted small' }, 'Costs a cent or two. Any notes or swaps you have marked above are applied in the same go.')));
        text.focus();
      } }, '+ Add a moment here');
      box.append(open);
      return box;
    };
    const room = s.scenes.length < maxTotal;
    const stream = [];
    if (room) stream.push(slot(null));
    cards.forEach((c, i) => { stream.push(c); if (room) stream.push(slot(s.scenes[i].id)); });
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
      pictured.size ? h('p', { class: 'note' }, `${pictured.size} of these scenes already have pictures, and they are safe: writing prompts and making images only adds new pictures. Tick just the new moment(s), then write prompts for them. Existing pictures are on the Images tab, where you can also reorder them.`) : null,
      h('p', { class: 'muted' }, `Tick the moments you want illustrated (up to ${max}). Add notes or ask for a replacement, then refine, or use "+ Add a moment here" to describe one of your own. Each costs a cent or two.`),
      stream,
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
        h('input', { type: 'checkbox', checked: true, 'data-file': f }), h('span', null, refName(f), ' ', h('span', { class: 'muted small' }, `(${refKind(f)})`))));
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

  /* ---- enlarge a picture: click it, then click again to see it at full size; arrows/Esc work ---- */
  function openLightbox(list, start) {
    if (!list.length) return;
    const from = document.activeElement;
    let i = start || 0, token = 0;
    const img = h('img', { alt: '' });
    const cap = h('div', { class: 'lb-cap' });
    const stage = h('div', { class: 'lb-stage' }, img);
    const box = h('div', { class: 'lightbox', id: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Enlarged picture' });
    const close = () => { document.removeEventListener('keydown', onKey, true); box.remove(); if (from && from.focus) from.focus(); };
    const go = async (n) => {
      i = (n + list.length) % list.length;
      const mine = ++token;
      cap.textContent = list[i].caption || '';
      img.classList.remove('zoom'); stage.scrollTo(0, 0); img.removeAttribute('src');
      try { const u = await list[i].url(); if (mine === token) img.src = u; } catch { if (mine === token) cap.textContent = 'This picture could not be loaded.'; }
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft' && list.length > 1) { e.stopPropagation(); go(i - 1); }
      else if (e.key === 'ArrowRight' && list.length > 1) { e.stopPropagation(); go(i + 1); }
    }
    img.addEventListener('click', () => img.classList.toggle('zoom'));
    box.addEventListener('click', (e) => { if (e.target === box || e.target === stage) close(); });
    const closeBtn = h('button', { class: 'btn lb-close', type: 'button', 'aria-label': 'Close', onclick: close }, '✕ Close');
    box.append(stage, cap, closeBtn);
    if (list.length > 1) {
      box.append(h('button', { class: 'btn ghost lb-nav lb-prev', type: 'button', 'aria-label': 'Previous picture', onclick: () => go(i - 1) }, '‹'),
        h('button', { class: 'btn ghost lb-nav lb-next', type: 'button', 'aria-label': 'Next picture', onclick: () => go(i + 1) }, '›'));
    }
    document.addEventListener('keydown', onKey, true);
    document.body.append(box);
    closeBtn.focus();
    go(i);
  }
  const imageUrl = (file) => () => repoImage(P.base + 'docs/' + file);
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  function imagesStage() {
    const s = W.session;
    const picks = new Set();
    const items = s.images.map((im) => ({ name: im.file.split('/').pop(), file: im.file, caption: im.caption || '',
      scene_id: im.scene_id || '', prompt: im.prompt || '', refs: [...(im.references || [])], note: im.note || '', made: im.made || '',
      versions: (im.versions || []).map((v) => ({ name: v.file.split('/').pop(), file: v.file, note: v.note || '', made: v.made || '' })) }));
    if (W.view && !items[W.view.idx]) W.view = null;
    const orig = JSON.stringify(items.map((i) => [i.name, i.caption]));
    const isDirty = () => JSON.stringify(items.map((i) => [i.name, i.caption])) !== orig;
    const panel = h('div', { class: 'panel' });
    const unsavedGuard = () => {
      if (isDirty()) { setBanner('err', 'Save your caption and order changes first.'); return false; }
      return true;
    };

    /* ---------- one image, with its own tabs ---------- */
    function detail() {
      const i = W.view.idx, it = items[i];
      const tab = W.view.tab || 'refine';
      const big = h('img', { alt: it.caption || `Image ${i + 1}`, class: 'big', title: 'Click to enlarge' });
      repoImage(P.base + 'docs/' + it.file).then((u) => { big.src = u; }).catch(() => { big.src = it.file; });
      big.addEventListener('click', () => openLightbox(items.map((x) => ({ url: imageUrl(x.file), caption: x.caption })), i));
      const tabBtn = (key, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': tab === key ? 'true' : 'false', 'data-tab': key,
        onclick: () => { W.view.tab = key; paint(); } }, label);
      const body = tab === 'alts' ? altsTab(it, i) : tab === 'prompt' ? promptTab(it) : refineTab(it);
      return h('div', { class: 'img-detail' },
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' },
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => { W.view = null; paint(); } }, '← All images'),
          h('span', { class: 'muted small' }, `Image ${i + 1} of ${items.length}`),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost small', type: 'button', disabled: i === 0, 'aria-label': 'Previous image', onclick: () => { W.view = { idx: i - 1, tab }; paint(); } }, '‹ Prev'),
            h('button', { class: 'btn ghost small', type: 'button', disabled: i === items.length - 1, 'aria-label': 'Next image', onclick: () => { W.view = { idx: i + 1, tab }; paint(); } }, 'Next ›'))),
        h('div', { class: 'detail-grid' },
          h('div', null, big, h('p', { class: 'muted small' }, it.caption || 'No caption', ' · click the picture to enlarge')),
          h('div', null,
            h('div', { class: 'tabs', role: 'tablist' }, tabBtn('refine', 'Refine'), tabBtn('alts', `Alternatives (${it.versions.length})`), tabBtn('prompt', 'Prompt & redo')),
            body,
            h('div', { class: 'row', style: 'margin-top:14px' },
              h('button', { class: 'btn danger small act', type: 'button', onclick: async () => {
                if (!confirm(`Delete this image and its ${it.versions.length} alternative(s)? This deletes the files and cannot be undone.`)) return;
                W.view = null;
                await runStep('remove', s.id, { files: [it.name] }, 'Deleting image');
              } }, 'Delete this image'),
              h('span', { class: 'muted small' }, 'Or just pick an older version under Alternatives.')))));
    }

    function refineTab(it) {
      const max = W.cfg.caps.max_refine_chars || 600;
      const ta = h('textarea', { rows: '4', maxlength: String(max), id: 'refine-text', 'aria-label': 'What should change',
        placeholder: 'Describe the one change, e.g. “give the barbarian a red cloak” or “make it night time”' });
      const chosen = new Set();
      const cost = () => imgCost() + refCost() * chosen.size;
      const go = h('button', { class: 'btn primary act', type: 'button', id: 'refine-go', onclick: async () => {
        if (!unsavedGuard()) return;
        const text = ta.value.trim();
        if (!text) { setBanner('err', 'Say what should change first.'); return; }
        if (!confirm(`Send this picture to the image model with your change? It costs about ${money(cost())}. The current picture is kept under Alternatives.`)) return;
        const ok = await runStep('refine_image', s.id, { file: it.name, instruction: text, references: [...chosen] }, 'Refining image');
        if (ok && W.view) { W.view.tab = 'alts'; paint(); }
      } }, '');
      const upd = () => { go.textContent = `Refine this picture (about ${money(cost())})`; };
      const refBoxes = W.refs.map((f) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? chosen.add(f) : chosen.delete(f); upd(); } }),
        h('span', null, refName(f), ' ', h('span', { class: 'muted small' }, `(${refKind(f)})`))));
      upd();
      return h('div', { class: 'redo' },
        h('p', { class: 'muted small' }, 'Keeps the picture as it is and changes only what you ask. The picture itself is sent to the image model (OpenAI) with your instruction. One change at a time works best.'),
        h('label', null, 'What should change?', ta),
        refBoxes.length ? h('div', null, h('div', { class: 'muted small', style: 'margin:8px 0' }, `Optional: also send reference pictures (up to ${W.cfg.caps.max_references_per_image}) to copy a look from:`),
          h('div', { class: 'row' }, refBoxes)) : null,
        h('div', { class: 'row', style: 'margin-top:10px' }, go),
        h('p', { class: 'muted small' }, 'The current picture is kept under Alternatives, so you can go back if the result is worse.'));
    }

    function altsTab(it, i) {
      const everyone = [{ name: it.name, file: it.file, note: it.note, made: it.made, current: true }, ...[...it.versions].reverse()];
      const lightList = everyone.map((v) => ({ url: imageUrl(v.file), caption: v.current ? 'Current picture' : (v.note || 'Earlier picture') }));
      const tiles = everyone.map((v, k) => {
        const img = h('img', { alt: v.current ? 'Current picture' : 'Earlier picture', title: 'Click to enlarge', loading: 'lazy' });
        repoImage(P.base + 'docs/' + v.file).then((u) => { img.src = u; }).catch(() => { img.src = v.file; });
        img.addEventListener('click', () => openLightbox(lightList, k));
        return h('figure', { class: 'alt' + (v.current ? ' current' : ''), 'data-file': v.name, style: 'margin:0' }, img,
          h('figcaption', null,
            h('div', { class: 'small' }, v.current ? h('b', null, 'Current') : 'Earlier', v.made ? h('span', { class: 'muted' }, ` · ${when(v.made)}`) : null),
            v.note ? h('div', { class: 'muted small' }, `Change asked: ${v.note}`) : null,
            v.current ? null : h('div', { class: 'row', style: 'margin-top:6px' },
              h('button', { class: 'btn small act use-version', type: 'button', onclick: async () => {
                if (!unsavedGuard()) return;
                await runStep('version', s.id, { file: it.name, action: 'use', version: v.name }, 'Switching picture');
              } }, 'Use this one'),
              h('button', { class: 'btn ghost small act del-version', type: 'button', onclick: async () => {
                if (!confirm('Delete this alternative? The file is removed and this cannot be undone.')) return;
                await runStep('version', s.id, { file: it.name, action: 'delete', version: v.name }, 'Deleting alternative');
              } }, 'Delete'))));
      });
      const limit = W.cfg.caps.max_versions_per_image || 5;
      return h('div', null,
        h('p', { class: 'muted small' }, `Every time you refine or redo a picture, the one it replaces is kept here (the newest ${limit}). Choosing one swaps it into the slideshow; the one you swap out becomes an alternative. Free, no new picture is made.`),
        it.versions.length ? h('div', { class: 'alts' }, tiles) : h('p', { class: 'muted' }, 'No alternatives yet. Refine or redo this picture and the earlier one will appear here.'));
    }

    function promptTab(it) {
      const cap = W.cfg.caps.max_prompt_chars;
      const ta = h('textarea', { rows: '8', maxlength: String(cap), value: it.prompt, 'aria-label': 'Image prompt' });
      const count = h('div', { class: 'counter' }, `${it.prompt.length} / ${cap}`);
      ta.addEventListener('input', () => { it.prompt = ta.value; count.textContent = `${ta.value.length} / ${cap}`; });
      const files = [...new Set([...W.refs, ...it.refs])];
      const refBoxes = files.map((f) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: it.refs.includes(f),
          onchange: (e) => { it.refs = e.target.checked ? [...it.refs, f] : it.refs.filter((x) => x !== f); } }),
        h('span', null, refName(f), ' ', h('span', { class: 'muted small' }, `(${refKind(f)})`))));
      const guard = () => {
        if (!unsavedGuard()) return false;
        if (!it.prompt.trim()) { setBanner('err', 'The prompt can\'t be empty.'); return false; }
        return true;
      };
      const cost = imgCost() + refCost() * it.refs.length;
      const wish = h('input', { type: 'text', maxlength: String(W.cfg.caps.max_note_chars), 'aria-label': 'What should change in the prompt',
        placeholder: 'Optional: what should change, e.g. “make Farq the focus”' });
      return h('div', { class: 'redo' },
        h('div', { class: 'rewrite' },
          h('div', { class: 'muted small', style: 'margin-bottom:4px' }, 'Have Claude write a new prompt for this scene, using your current character descriptions and pictures. It does not make a picture; use Redo for that.'),
          wish,
          h('div', { class: 'row', style: 'margin-top:6px' },
            h('button', { class: 'btn act rewrite-btn', type: 'button', onclick: async () => {
              if (!unsavedGuard()) return;
              await runStep('reprompt', s.id, { items: [{ file: it.name, note: wish.value.trim() }] }, 'Rewriting prompt');
            } }, 'Rewrite prompt with Claude'),
            h('span', { class: 'muted small' }, 'A cent or two. Any prompt edits below are replaced.'))),
        h('label', null, 'Prompt used for this image', ta), count,
        refBoxes.length ? h('div', null, h('div', { class: 'muted small', style: 'margin:6px 0' }, 'Reference pictures to send:'), h('div', { class: 'row' }, refBoxes)) : null,
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'btn act', type: 'button', onclick: async () => {
            if (!guard()) return;
            await runStep('edit', s.id, { image_prompts: { [it.name]: it.prompt.trim() } }, 'Saving prompt');
          } }, 'Save prompt only'),
          h('button', { class: 'btn primary act', type: 'button', onclick: async () => {
            if (!guard()) return;
            if (!confirm(`Make a new picture from this prompt and replace this one? It costs about ${money(cost)}. The current picture is kept under Alternatives.`)) return;
            const ok = await runStep('generate', s.id, { prompts: [{ scene_id: it.scene_id, caption: it.caption.trim(), prompt: it.prompt.trim(),
              references: it.refs, replaces: it.name }] }, 'Redoing image');
            if (ok && W.view) { W.view.tab = 'alts'; paint(); }
          } }, `Redo this image (about ${money(cost)})`)),
        h('p', { class: 'muted small' }, 'Redo makes a brand-new picture from the prompt (it does not look at the current one; use Refine for a small change). The old picture is kept under Alternatives.'));
    }

    /* ---------- the grid of all images ---------- */
    const grid = h('div', { class: 'imgs' });
    const removeBtn = h('button', { class: 'btn act', 'data-off': '1', disabled: true, onclick: async () => {
      if (!picks.size) return;
      if (!confirm(`Remove ${picks.size} image(s) from this session? This deletes the files, including their alternatives.`)) return;
      await runStep('remove', s.id, { files: [...picks] }, 'Removing images');
    } }, 'Remove selected');
    const saveBtn = h('button', { class: 'btn primary act', 'data-off': '1', disabled: true, onclick: async () => {
      const captions = {};
      items.forEach((i) => { captions[i.name] = i.caption; });
      await runStep('edit', s.id, { captions, order: items.map((i) => i.name) }, 'Saving captions and order');
    } }, 'Save captions & order');
    function dirty() {
      const d = isDirty();
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
        const img = h('img', { alt: it.caption || 'Generated image', loading: 'lazy', title: 'Click to enlarge' });
        repoImage(P.base + 'docs/' + it.file).then((u) => { img.src = u; }).catch(() => { img.src = it.file; });
        img.addEventListener('click', () => openLightbox(items.map((x) => ({ url: imageUrl(x.file), caption: x.caption })), i));
        const cap = h('input', { type: 'text', maxlength: '200', value: it.caption, placeholder: 'Caption', 'aria-label': `Caption for image ${i + 1}`,
          oninput: (e) => { it.caption = e.target.value; dirty(); } });
        return h('figure', { class: 'img', style: 'margin:0' }, img,
          h('label', { class: 'check pick' }, h('input', { type: 'checkbox', 'aria-label': `Select image ${i + 1}`, checked: picks.has(it.name),
            onchange: (e) => { e.target.checked ? picks.add(it.name) : picks.delete(it.name);
              removeBtn.dataset.off = picks.size ? '0' : '1'; removeBtn.disabled = W.busy || !picks.size; } }), 'Select'),
          it.versions.length ? h('span', { class: 'alt-count', title: 'Earlier versions kept' }, `${it.versions.length} alt`) : null,
          h('figcaption', null, cap,
            h('button', { class: 'btn small open-image', type: 'button', onclick: () => {
              if (!unsavedGuard()) return;
              W.view = { idx: i, tab: 'refine' }; paint();
            } }, 'Open: refine, alternatives, prompt'),
            h('div', { class: 'row mover' },
              h('button', { class: 'btn ghost small', type: 'button', disabled: i === 0, 'aria-label': 'Move earlier', onclick: () => move(i, -1) }, '←'),
              h('span', { class: 'muted small' }, `${i + 1} of ${items.length}`),
              h('button', { class: 'btn ghost small', type: 'button', disabled: i === items.length - 1, 'aria-label': 'Move later', onclick: () => move(i, 1) }, '→'))));
      }));
    }
    draw();
    if (W.view) {
      panel.replaceChildren(h('h2', null, 'Images'), detail());
    } else {
      panel.replaceChildren(h('h2', null, 'Images'),
        h('p', { class: 'muted' }, 'Edit captions and reorder, then save. The first image is the session\'s cover. The public slideshow updates about a minute after each change. Click a picture to enlarge it. Press "Open" on a picture to refine it, bring back an earlier version, or change its prompt.'),
        grid,
        h('div', { class: 'sticky-bar' }, h('div', { class: 'row' }, saveBtn, removeBtn),
          h('button', { class: 'btn act', 'data-off': s.prompts.length ? null : '1', onclick: () => { W.stage = 'prompts'; paint(); }, disabled: !s.prompts.length }, 'Edit prompts / make more')));
    }
    return panel;
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
