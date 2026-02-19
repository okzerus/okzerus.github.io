// script.js - full replacement (defines initBlurTargetsForChapter to avoid ReferenceError)
// NOTE: replace your existing script.js entirely with this file and hard-refresh the page.

document.addEventListener('DOMContentLoaded', () => {
  /* ---------------------- DOM refs ---------------------- */
  const chaptersListEl = document.getElementById('chapters');
  const chapterBodyEl = document.getElementById('chapter-body');
  const chapterTitleEl = document.getElementById('chapter-title');
  const themeToggle = document.getElementById('theme-toggle');
  const blurToggle = document.getElementById('blur-toggle');
  const headerEl = document.querySelector('header');

  const bottomPrev = document.getElementById('bottom-prev');
  const bottomNext = document.getElementById('bottom-next');
  const bottomNav = document.getElementById('bottom-nav');

  const topPrev = document.getElementById('top-prev');
  const topNext = document.getElementById('top-next');
  const topNav = document.getElementById('top-nav');

  const chaptersAside = document.getElementById('chapters-list');

  const colorPopup = document.getElementById('color-popup');
  const colorArea = document.getElementById('color-area');
  const colorAreaCursor = document.getElementById('color-area-cursor');
  const hueSlider = document.getElementById('hue-slider');
  const hueCursor = document.getElementById('hue-cursor');
  const colorResetBtn = document.getElementById('color-reset');

  if (!chaptersListEl || !chapterBodyEl || !chapterTitleEl) {
    console.error('Essential DOM elements missing. Check index.html IDs.');
    if (chapterBodyEl) chapterBodyEl.textContent = 'Ошибка: элементы страницы отсутствуют. Проверьте index.html.';
    return;
  }

  /* ---------------------- state ---------------------- */
  let chapters = [];
  let currentIndex = -1;
  let lastChapterFile = null;
  const resolvedUrlCache = new Map();
  const preloadedImgCache = new Map();

  let edgeBtn = null;
  let lastEdgePos = null;
  let edgePosScheduled = false;

  const BLUR_THRESHOLD_Y_RATIO = 0.5; // middle of viewport
  const BLUR_VISUAL_KEY = 'blur-visual-enabled';
  const STORAGE_KEY = 'site-bg-color';

  /* ---------------------- Utility helpers ---------------------- */
  function hexToRgb(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min; let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, v };
  }
  function hsvToRgb(h, s, v) {
    h = (h % 360 + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }

  function luminanceFromRgb(r, g, b) {
    const srgb = [r, g, b].map(v => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }

  /* ---------------------- Color picker minimal wiring ---------------------- */
  // Keep to minimal functionality necessary for color persistence and apply
  const DEFAULT_BG_HEX = '#0b0f13';
  (function initColor() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || DEFAULT_BG_HEX;
      const { r, g, b } = hexToRgb(stored);
      applyColorHex(stored);
    } catch (e) {
      applyColorHex(DEFAULT_BG_HEX);
    }
  })();

  function applyColorHex(hex) {
    const { r, g, b } = hexToRgb(hex);
    document.documentElement.style.setProperty('--bg', hex);
    const lum = luminanceFromRgb(r, g, b);
    if (lum < 0.5) {
      document.documentElement.style.setProperty('--accent', '#e6eef6');
      document.documentElement.style.setProperty('--btn-fg', '#e6eef6');
      document.documentElement.style.setProperty('--tooltip-link-color', '#bfe8ff');
    } else {
      document.documentElement.style.setProperty('--accent', '#132029');
      document.documentElement.style.setProperty('--btn-fg', '#132029');
      document.documentElement.style.setProperty('--tooltip-link-color', '#1b6ea1');
    }
  }

  /* ---------------------- Tooltip image resolving & preload ---------------------- */
  function testImageUrl(url, timeout = 3000) {
    return new Promise(resolve => {
      const img = new Image();
      let done = false;
      const onLoad = () => { if (done) return; done = true; cleanup(); resolve(true); };
      const onErr = () => { if (done) return; done = true; cleanup(); resolve(false); };
      const cleanup = () => { img.onload = img.onerror = null; clearTimeout(timer); };
      img.onload = onLoad; img.onerror = onErr; img.src = url;
      const timer = setTimeout(() => { if (done) return; done = true; cleanup(); resolve(false); }, timeout);
    });
  }

  async function resolveTooltipImage(srcCandidate) {
    if (!srcCandidate) return null;
    if (resolvedUrlCache.has(srcCandidate)) return resolvedUrlCache.get(srcCandidate);
    if (/^https?:\/\//i.test(srcCandidate) || srcCandidate.startsWith('/')) {
      if (await testImageUrl(srcCandidate)) { resolvedUrlCache.set(srcCandidate, srcCandidate); return srcCandidate; }
    }
    const bases = [window.location.href, window.location.origin + window.location.pathname];
    if (lastChapterFile) {
      bases.push(window.location.origin + '/' + lastChapterFile);
      const parts = lastChapterFile.split('/'); parts.pop();
      const parent = parts.join('/');
      if (parent) bases.push(window.location.origin + '/' + parent + '/');
    }
    bases.push(window.location.origin + '/');
    for (const base of bases) {
      try {
        const u = new URL(srcCandidate, base).href;
        if (await testImageUrl(u)) { resolvedUrlCache.set(srcCandidate, u); return u; }
      } catch (e) {}
    }
    resolvedUrlCache.set(srcCandidate, null);
    return null;
  }

  async function preloadTooltipImages() {
    if (!chapterBodyEl) return;
    const glossEls = Array.from(chapterBodyEl.querySelectorAll('.gloss'));
    for (const el of glossEls) {
      const dataImg = el.getAttribute('data-img');
      if (!dataImg) continue;
      try {
        const resolved = await resolveTooltipImage(dataImg);
        if (resolved && !preloadedImgCache.has(resolved)) {
          const pimg = new Image(); pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async';
          preloadedImgCache.set(resolved, pimg);
          pimg.src = resolved;
        }
      } catch (e) {}
    }
  }

  /* ---------------------- Tippy init (minimal) ---------------------- */
  function initGlossTippy() {
    if (!window.tippy) return;
    document.querySelectorAll('.gloss').forEach(el => { try { if (el._tippy) el._tippy.destroy(); } catch (e) {} });
    tippy('.gloss', {
      allowHTML: true,
      interactive: true,
      delay: [60, 80],
      maxWidth: 520,
      placement: 'top',
      offset: [0, 8],
      appendTo: () => document.body,
      popperOptions: { strategy: 'fixed', modifiers: [{ name:'computeStyles', options:{adaptive:false} },{ name: 'preventOverflow', options:{padding:8, altAxis:true} },{ name:'flip', options:{fallbackPlacements:['bottom','right','left']} }] },
      content: 'Loading...',
      onShow: async instance => {
        const reference = instance.reference;
        let contentHTML = reference.getAttribute('data-tippy-content') || reference.getAttribute('title') || reference.innerHTML || '';
        if (reference.getAttribute('title')) reference.removeAttribute('title');
        const dataImg = reference.getAttribute('data-img');
        const imgAlt = reference.getAttribute('data-img-alt') || '';
        const wrapper = document.createElement('div');
        let resolved = null;
        if (dataImg) {
          resolved = resolvedUrlCache.has(dataImg) ? resolvedUrlCache.get(dataImg) : await resolveTooltipImage(dataImg);
        }
        if (resolved) {
          if (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete) {
            const pimg = new Image(); pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async';
            preloadedImgCache.set(resolved, pimg);
            pimg.src = resolved;
          }
          const imgEl = document.createElement('img');
          imgEl.className = 'tooltip-img'; imgEl.src = resolved; imgEl.alt = imgAlt; imgEl.loading = 'eager'; imgEl.style.cursor = 'pointer';
          imgEl.addEventListener('click', (ev) => { ev.stopPropagation(); openImageViewer(resolved, imgAlt); try { instance.hide(); } catch (e) {} });
          wrapper.appendChild(imgEl);
        }
        const contentDiv = document.createElement('div'); contentDiv.className = 'tooltip-body'; contentDiv.innerHTML = contentHTML;
        wrapper.appendChild(contentDiv);
        try { instance.setContent(wrapper); } catch (e) { instance.setContent(wrapper.outerHTML); }
      }
    });
  }

  /* ---------------------- Image viewer (minimal & robust) ---------------------- */
  if (!document.getElementById('image-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'image-overlay';
    overlay.innerHTML = `<div class="viewer" role="dialog" aria-modal="true"><img class="viewer-img" src="" alt=""></div>`;
    document.body.appendChild(overlay);
  }
  const overlay = document.getElementById('image-overlay');
  const overlayImg = overlay.querySelector('.viewer-img');

  let isZoomed = false, pointerDown = false, pointerStart = { x: 0, y: 0 }, imgPos = { x: 0, y: 0 }, dragMoved = false, suppressClick = false;
  const DRAG_THRESHOLD = 4;

  function openImageViewer(src, alt = '') {
    overlayImg.src = src; overlayImg.alt = alt || '';
    const marginPx = 40;
    overlayImg.style.maxWidth = `calc(100vw - ${marginPx}px)`; overlayImg.style.maxHeight = `calc(100vh - ${Math.round(marginPx * 1.5)}px)`;
    overlay.classList.add('visible'); isZoomed = false; imgPos = { x: 0, y: 0 }; overlayImg.style.transform = `translate(0px, 0px) scale(1)`; overlayImg.classList.remove('zoomed'); overlay.style.cursor = 'default'; document.body.style.overflow = 'hidden';
  }
  function closeImageViewer() { overlay.classList.remove('visible'); overlayImg.src = ''; isZoomed = false; pointerDown = false; dragMoved = false; suppressClick = false; document.body.style.overflow = ''; overlayImg.style.maxWidth = ''; overlayImg.style.maxHeight = ''; }
  function applyImageTransform() {
    const scale = isZoomed ? 2 : 1;
    overlayImg.style.transform = `translate(${imgPos.x}px, ${imgPos.y}px) scale(${scale})`;
    if (isZoomed) overlayImg.classList.add('zoomed'); else overlayImg.classList.remove('zoomed');
  }
  overlayImg.addEventListener('click', (ev) => {
    if (suppressClick) { suppressClick = false; return; }
    isZoomed = !isZoomed;
    if (!isZoomed) imgPos = { x: 0, y: 0 };
    applyImageTransform();
  });
  overlayImg.addEventListener('mousedown', (ev) => {
    if (!isZoomed) return; ev.preventDefault(); pointerDown = true; dragMoved = false; pointerStart = { x: ev.clientX, y: ev.clientY }; overlayImg.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (ev) => {
    if (!pointerDown || !isZoomed) return;
    const dx = ev.clientX - pointerStart.x; const dy = ev.clientY - pointerStart.y;
    if (!dragMoved && (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD)) dragMoved = true;
    if (dragMoved) { pointerStart = { x: ev.clientX, y: ev.clientY }; imgPos.x += dx; imgPos.y += dy; applyImageTransform(); }
  });
  window.addEventListener('mouseup', (ev) => {
    if (pointerDown && dragMoved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
    pointerDown = false; overlayImg.style.cursor = isZoomed ? 'grab' : 'zoom-in';
  });
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeImageViewer(); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && overlay.classList.contains('visible')) closeImageViewer(); });

  function bindImagesToViewer() {
    const imgs = chapterBodyEl.querySelectorAll('img');
    imgs.forEach(img => {
      img.style.cursor = 'pointer';
      if (!img._viewerBound) {
        img.addEventListener('click', (e) => {
          const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
          if (!src) return;
          openImageViewer(src, img.getAttribute('alt') || '');
        });
        img._viewerBound = true;
      }
    });
  }

  /* ---------------------- Blur & read tracking ---------------------- */
  function readStorageKeyFor(filename) { return 'read:' + filename; }
  function loadReadIndicesFor(filename) {
    try {
      const raw = localStorage.getItem(readStorageKeyFor(filename));
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr);
    } catch (e) { return new Set(); }
  }
  function saveReadIndicesFor(filename, set) {
    try { localStorage.setItem(readStorageKeyFor(filename), JSON.stringify(Array.from(set))); } catch (e) {}
  }

  function isVisualBlurEnabled() {
    try {
      const v = localStorage.getItem(BLUR_VISUAL_KEY);
      if (v === null) return true;
      return v === 'true';
    } catch (e) { return true; }
  }
  function setVisualBlurEnabled(enabled) {
    try { localStorage.setItem(BLUR_VISUAL_KEY, enabled ? 'true' : 'false'); } catch (e) {}
    if (enabled) document.body.classList.remove('blur-visual-off'); else document.body.classList.add('blur-visual-off');
    if (!enabled) {
      document.querySelectorAll('.blur-target.is-blurred').forEach(el => el.classList.remove('is-blurred'));
    } else {
      document.querySelectorAll('.blur-target:not(.unblurred)').forEach(el => el.classList.add('is-blurred'));
    }
    updateEdgeScrollVisibility();
  }

  // collect targets (top-level children and images inside)
  function collectTargets() {
    const targets = [];
    const children = Array.from(chapterBodyEl.children);
    children.forEach(child => {
      const imgs = Array.from(child.querySelectorAll('img'));
      if (imgs.length > 0 && child.tagName.toLowerCase() !== 'img') {
        imgs.forEach(img => targets.push(img));
      } else {
        targets.push(child);
      }
    });
    return targets;
  }

  function applyBlurToTarget(el) {
    if (!el) return;
    el.classList.add('blur-target');
    if (!el.classList.contains('unblurred')) {
      if (isVisualBlurEnabled()) el.classList.add('is-blurred');
    }
  }

  function removeBlurFromTarget(el, markRead = true) {
    if (!el) return;
    if (el.classList.contains('unblurred')) return;
    el.classList.remove('is-blurred');
    el.classList.add('unblurred');
    if (markRead && lastChapterFile) {
      const set = loadReadIndicesFor(lastChapterFile);
      const index = Number(el.dataset.blurIndex);
      if (!Number.isNaN(index)) { set.add(index); saveReadIndicesFor(lastChapterFile, set); }
    }
    updateEdgeScrollVisibility();
  }

  function revealTemp(el) { if (!el) return; if (el.classList.contains('unblurred')) return; el.classList.add('hover-reveal'); }
  function hideTemp(el) { if (!el) return; if (el.classList.contains('unblurred')) return; el.classList.remove('hover-reveal'); }

  /* ---------- IMPORTANT: initBlurTargetsForChapter (must exist before loadChapter) ---------- */
  function initBlurTargetsForChapter(filename, blurEnabled = true) {
    if (!chapterBodyEl) return;
    // clear previous markers
    chapterBodyEl.querySelectorAll('.blur-target').forEach(old => {
      old.classList.remove('is-blurred', 'hover-reveal', 'unblurred', 'blur-target');
    });

    // prepare glow data if any (safe no-op if captureGlowInfo not present)
    try { captureGlowInfo(); } catch (e) {}

    const targets = collectTargets();
    const readSet = loadReadIndicesFor(filename);

    targets.forEach((el, idx) => {
      try {
        el.dataset.blurIndex = idx;
        el.classList.add('blur-target');

        if (!blurEnabled) {
          el.classList.add('unblurred');
          el.classList.remove('is-blurred');
          return;
        }

        if (el.classList.contains('unblurred') || readSet.has(idx)) {
          el.classList.add('unblurred');
          el.classList.remove('is-blurred');
        } else {
          if (isVisualBlurEnabled()) el.classList.add('is-blurred');
        }

        el.addEventListener('mouseenter', () => { if (!el.classList.contains('unblurred')) revealTemp(el); });
        el.addEventListener('mouseleave', () => { if (!el.classList.contains('unblurred')) hideTemp(el); });
        el.addEventListener('touchstart', () => { if (!el.classList.contains('unblurred')) revealTemp(el); }, {passive:true});
        el.addEventListener('touchend', () => { if (!el.classList.contains('unblurred')) hideTemp(el); }, {passive:true});
      } catch (e) {}
    });

    updateEdgeScrollVisibility();
  }

  /* ---------- Basic glitch support helpers (if present later) ---------- */
  // minimal no-op placeholders so code referencing them won't break if glitch-specific logic not included
  function captureGlowInfo() { /* may be extended elsewhere; safe placeholder */ }

  /* ---------- nav helpers (done flag aware) ---------- */
  function isDoneEntry(entry) { if (!entry) return false; return entry.done !== false; }
  function findPrevDoneIndex(fromIndex) { for (let i = (fromIndex === undefined ? currentIndex - 1 : fromIndex); i >= 0; i--) if (isDoneEntry(chapters[i])) return i; return -1; }
  function findNextDoneIndex(fromIndex) { for (let i = (fromIndex === undefined ? currentIndex + 1 : fromIndex); i < chapters.length; i++) if (isDoneEntry(chapters[i])) return i; return -1; }
  function findFirstDoneIndex() { return findNextDoneIndex(0); }

  function updateNavButtons() {
    const prevIndex = findPrevDoneIndex();
    const nextIndex = findNextDoneIndex();
    const prevDisabled = prevIndex === -1;
    const nextDisabled = nextIndex === -1;
    [bottomPrev, topPrev].forEach(btn => { if (btn) btn.disabled = prevDisabled; });
    [bottomNext, topNext].forEach(btn => { if (btn) btn.disabled = nextDisabled; });

    if (!prevDisabled) {
      const p = chapters[prevIndex];
      [bottomPrev, topPrev].forEach(btn => { if (btn) { btn.dataset.index = prevIndex; btn.dataset.title = p.title || ''; }});
    } else { [bottomPrev, topPrev].forEach(btn => { if (btn) { btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }}); }

    if (!nextDisabled) {
      const n = chapters[nextIndex];
      [bottomNext, topNext].forEach(btn => { if (btn) { btn.dataset.index = nextIndex; btn.dataset.title = n.title || ''; }});
    } else { [bottomNext, topNext].forEach(btn => { if (btn) { btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }}); }

    refreshNavTippies();
  }

  function goToChapter(index) {
    if (!chapters || index < 0 || index >= chapters.length) return;
    if (!isDoneEntry(chapters[index])) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    window.scrollTo({ top: 0, behavior: 'auto' });
    closeChapters();
    try { localStorage.setItem('last-chapter-file', c.file); } catch (e) {}
  }

  [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index);
      if (!Number.isNaN(i)) goToChapter(i);
    });
  });

  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if (e.key === 'ArrowLeft') { const prev = findPrevDoneIndex(); if (prev !== -1) goToChapter(prev); }
    if (e.key === 'ArrowRight') { const next = findNextDoneIndex(); if (next !== -1) goToChapter(next); }
  });

  /* ---------- load chapters list ---------- */
  async function loadChapters() {
    chapterBodyEl.textContent = 'Загрузка...';
    try {
      const res = await fetch('chapters.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching chapters.json');
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('chapters.json is not an array');
      chapters = data;
      chaptersListEl.innerHTML = '';
      chapters.forEach((c, i) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = c.title || `Глава ${i+1}`;
        if (!isDoneEntry(c)) { a.classList.add('undone'); }
        else { a.addEventListener('click', (e) => { e.preventDefault(); goToChapter(i); closeChapters(); }); }
        li.appendChild(a);
        chaptersListEl.appendChild(li);
      });

      const saved = localStorage.getItem('last-chapter-file');
      if (saved) {
        const idx = chapters.findIndex(ch => ch && ch.file === saved && isDoneEntry(ch));
        if (idx !== -1) { goToChapter(idx); return; }
      }

      const first = findFirstDoneIndex();
      if (first !== -1) goToChapter(first);
      else { chapterBodyEl.textContent = 'В репозитории нет доступных (done) глав.'; updateNavButtons(); }
    } catch (err) {
      chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message;
      console.error('loadChapters error:', err);
      [bottomPrev, bottomNext, topPrev, topNext].forEach(b => { if (b) b.disabled = true; });
    }
  }

  /* ---------- load a single chapter ---------- */
  async function loadChapter(filename, title) {
    chapterTitleEl.textContent = title || '';
    chapterBodyEl.textContent = 'Загрузка главы...';
    try {
      const res = await fetch('chapters/' + filename, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + filename);
      const md = await res.text();
      lastChapterFile = filename;
      const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: библиотека marked не загружена.</p>';
      chapterBodyEl.innerHTML = html;

      // detect blur enable flag from chapters list
      let blurEnabledForChapter = true;
      try { const chObj = chapters[currentIndex]; if (chObj && chObj.blur === false) blurEnabledForChapter = false; } catch (e) {}

      // initialize blur targets (this function now exists above)
      initBlurTargetsForChapter(filename, blurEnabledForChapter);

      // preload tooltip images and init tippy
      preloadTooltipImages();
      initGlossTippy();

      // bind images and other per-chapter setup
      bindImagesToViewer();

      updateNavButtons();

      // restore scroll on reload (sessionStorage)
      try {
        const key = 'scroll:' + filename;
        const v = sessionStorage.getItem(key);
        if (v !== null) {
          const scrollVal = Number(v) || 0;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.scrollTo({ top: scrollVal, behavior: 'auto' });
              try { sessionStorage.removeItem(key); } catch (e) {}
            });
          });
        }
      } catch (e) {}

      // initial unblur check
      requestAnimationFrame(checkAndUnblurVisibleTargets);

      // update edge button visibility & position
      updateEdgeScrollVisibility();
      updateEdgeScrollPosition();
    } catch (err) {
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
      console.error('loadChapter error:', err);
    }
  }

  /* ---------- blur/unblur scanning ---------- */
  let scrollScheduled = false;
  function checkAndUnblurVisibleTargets() {
    if (!chapterBodyEl) return;
    const centerY = window.innerHeight * BLUR_THRESHOLD_Y_RATIO;
    const atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 6);
    if (atBottom) {
      Array.from(chapterBodyEl.querySelectorAll('.blur-target:not(.unblurred)')).forEach(el => removeBlurFromTarget(el, true));
      return;
    }
    const nodes = Array.from(chapterBodyEl.querySelectorAll('.blur-target'));
    nodes.forEach(el => {
      if (el.classList.contains('unblurred')) return;
      const rect = el.getBoundingClientRect();
      let trigger = false;
      if (el.tagName && el.tagName.toLowerCase() === 'img') {
        if (rect.top < centerY) trigger = true;
      } else {
        if (rect.top < centerY) trigger = true;
      }
      if (trigger) removeBlurFromTarget(el, true);
    });
    updateEdgeScrollVisibility();
  }
  window.addEventListener('scroll', () => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      checkAndUnblurVisibleTargets();
      scrollScheduled = false;
    });
  }, { passive: true });
  window.addEventListener('resize', () => { checkAndUnblurVisibleTargets(); scheduleEdgePosUpdate(); });

  /* ---------------------- EDGE scroll button (minimal) ---------------------- */
  function createEdgeScrollButton() {
    if (edgeBtn) return;
    edgeBtn = document.createElement('button');
    edgeBtn.className = 'edge-scroll-btn';
    edgeBtn.id = 'edge-scroll-btn';
    edgeBtn.setAttribute('aria-label', 'Перейти к следующему скрытому фрагменту');
    edgeBtn.innerHTML = '▼';
    document.body.appendChild(edgeBtn);
    edgeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = findNextBlurTargetElement();
      if (!next) return;
      // remove is-blurred to start smooth fade-out and then scroll
      next.classList.remove('is-blurred');
      scrollToTargetElement(next);
      updateEdgeScrollVisibility();
    });
    updateEdgeScrollPosition();
  }

  function updateEdgeScrollPosition() {
    if (!edgeBtn) return;
    const content = document.getElementById('content');
    if (!content) return;
    const rect = content.getBoundingClientRect();
    if (rect.width < 120 || rect.right <= 0) {
      edgeBtn.style.opacity = '0'; edgeBtn.style.pointerEvents = 'none'; return;
    }
    const btnW = edgeBtn.offsetWidth || 34;
    const leftPx = Math.round(rect.right + window.scrollX - (btnW / 2));
    if (lastEdgePos === leftPx) return;
    edgeBtn.style.left = `${leftPx}px`;
    lastEdgePos = leftPx;
  }

  function findNextBlurTargetElement() {
    if (!chapterBodyEl) return null;
    const nodes = Array.from(chapterBodyEl.querySelectorAll('.blur-target:not(.unblurred)'));
    if (!nodes.length) return null;
    const MIN_HEIGHT_PX = 18;
    function isMeaningfulElement(el) {
      if (el.tagName && el.tagName.toLowerCase() === 'img') return true;
      if (el.querySelector && el.querySelector('img')) return true;
      if (el.textContent && el.textContent.trim().length > 0) return true;
      const r = el.getBoundingClientRect();
      if (r.height >= MIN_HEIGHT_PX) return true;
      return false;
    }
    const curScroll = window.scrollY || 0;
    const candidates = [];
    nodes.forEach(el => {
      try {
        if (!isMeaningfulElement(el)) return;
        const rect = el.getBoundingClientRect();
        const center = rect.top + window.scrollY + (rect.height / 2);
        candidates.push({ el, center });
      } catch (e) {}
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.center - b.center);
    const EPS = 2;
    for (const c of candidates) {
      if (c.center > curScroll + EPS) return c.el;
    }
    return null;
  }

  function scrollToTargetElement(el) {
    if (!el) return;
    function doScroll() {
      try {
        const rect = el.getBoundingClientRect();
        const elCenterY = rect.top + window.scrollY + (rect.height / 2);
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        let target = Math.round(elCenterY - (window.innerHeight / 2));
        if (target < 0) target = 0;
        if (target > maxScroll) target = maxScroll;
        window.scrollTo({ top: target, behavior: 'smooth' });
      } catch (e) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
  }

  function updateEdgeScrollVisibility() {
    createEdgeScrollButton();
    if (!edgeBtn) return;
    if (!isVisualBlurEnabled()) { edgeBtn.classList.remove('visible'); return; }
    let chapterBlurEnabled = true;
    try { const c = chapters[currentIndex]; if (c && c.blur === false) chapterBlurEnabled = false; } catch (e) {}
    if (!chapterBlurEnabled) { edgeBtn.classList.remove('visible'); return; }
    const next = findNextBlurTargetElement();
    if (next) { edgeBtn.classList.add('visible'); updateEdgeScrollPosition(); } else { edgeBtn.classList.remove('visible'); }
  }

  function scheduleEdgePosUpdate() {
    if (edgePosScheduled) return;
    edgePosScheduled = true;
    requestAnimationFrame(() => { updateEdgeScrollPosition(); edgePosScheduled = false; });
  }
  window.addEventListener('scroll', scheduleEdgePosUpdate, { passive: true });
  window.addEventListener('resize', scheduleEdgePosUpdate);

  /* ---------------------- Utilities used earlier (safe placeholders) ---------------------- */
  function refreshNavTippies() { /* no-op if tippy used elsewhere */ }

  /* ---------- start ---------- */
  createEdgeScrollButton();
  loadChapters();
  // small timing fix for top-nav or other layout
  setTimeout(() => { if (window.scrollY <= 10) { /* nothing specific here */ } }, 120);
});
