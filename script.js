// script.js - full replacement with color-picker background customization
// preserves: chapters loading, done flag, slide-out chapters, tippy with preloaded images,
// top/bottom nav with 1s hide rule, image viewer, and "restore scroll only on page reload" behavior.

document.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  const chaptersListEl = document.getElementById('chapters');
  const chapterBodyEl = document.getElementById('chapter-body');
  const chapterTitleEl = document.getElementById('chapter-title');
  const themeToggle = document.getElementById('theme-toggle'); // now opens color picker
  const headerEl = document.querySelector('header');

  const bottomPrev = document.getElementById('bottom-prev');
  const bottomNext = document.getElementById('bottom-next');
  const bottomNav = document.getElementById('bottom-nav');

  const topPrev = document.getElementById('top-prev');
  const topNext = document.getElementById('top-next');
  const topNav = document.getElementById('top-nav');

  const chaptersAside = document.getElementById('chapters-list');

  const colorPopup = document.getElementById('color-popup');
  const colorInput = document.getElementById('bg-color-picker');
  const colorSaveBtn = document.getElementById('color-save');
  const colorResetBtn = document.getElementById('color-reset');

  if (!chaptersListEl || !chapterBodyEl || !chapterTitleEl) {
    console.error('Essential DOM elements missing. Check index.html IDs.');
    if (chapterBodyEl) chapterBodyEl.textContent = 'Ошибка: элементы страницы отсутствуют. Проверьте index.html.';
    return;
  }

  // App state
  let chapters = [];
  let currentIndex = -1;
  let lastChapterFile = null; // e.g. '01.md' stored as chapters[i].file

  // Tooltip image caches
  const resolvedUrlCache = new Map();
  const preloadedImgCache = new Map();

  /* ---------------- Color picker / theme override ---------------- */

  // default background color (your current dark mode)
  const DEFAULT_BG = '#0b0f13';
  const STORAGE_KEY = 'site-bg-color';

  // helpers: color conversions & shading
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s, l: l };
  }
  function hslToRgb(h, s, l) {
    h /= 360;
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      }
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }
  function darkenHex(hex, amount) {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    hsl.l = Math.max(0, Math.min(1, hsl.l - amount));
    const rgb2 = hslToRgb(hsl.h, hsl.s, hsl.l);
    return rgbToHex(rgb2.r, rgb2.g, rgb2.b);
  }
  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    // relative luminance (sRGB)
    const srgb = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }

  function applyBackgroundColor(hex) {
    // set root vars (inline style)
    const root = document.documentElement;
    root.style.setProperty('--bg', hex);

    // card should be slightly darker than background (so text card contrasts)
    const card = darkenHex(hex, 0.08); // reduce lightness by 8%
    root.style.setProperty('--card', card);

    // button background slightly darker than card
    const btnBg = darkenHex(card, 0.04);
    root.style.setProperty('--btn-bg', btnBg);

    // Decide accent text color based on luminance (light text on dark backgrounds)
    const lum = luminance(hex);
    if (lum < 0.45) {
      // dark background -> light text
      root.style.setProperty('--accent', '#e6eef6');
      root.style.setProperty('--btn-fg', '#e6eef6');
    } else {
      // light background -> dark text
      root.style.setProperty('--accent', '#132029');
      root.style.setProperty('--btn-fg', '#132029');
    }

    // keep tooltip link color readable: pick a pale blue but slightly adjust for extreme backgrounds
    root.style.setProperty('--tooltip-link-color', lum < 0.45 ? '#bfe8ff' : '#1b6ea1');
  }

  // initialize color picker: load saved color or default
  function initColorPicker() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const color = saved || DEFAULT_BG;
    if (colorInput) colorInput.value = color;
    applyBackgroundColor(color);
  }

  // open/close behavior for popup
  function showColorPopup() {
    if (!colorPopup) return;
    colorPopup.classList.add('visible');
    colorPopup.setAttribute('aria-hidden', 'false');
    // focus input for immediate keyboard navigation
    if (colorInput) {
      colorInput.focus();
    }
    // attach outside click listener
    document.addEventListener('click', onDocumentClickForPopup);
  }
  function hideColorPopup() {
    if (!colorPopup) return;
    colorPopup.classList.remove('visible');
    colorPopup.setAttribute('aria-hidden', 'true');
    document.removeEventListener('click', onDocumentClickForPopup);
  }
  function onDocumentClickForPopup(e) {
    if (!colorPopup) return;
    if (colorPopup.contains(e.target) || (themeToggle && themeToggle.contains(e.target))) return;
    hideColorPopup();
  }

  // button toggles popup (no longer toggles "theme")
  if (themeToggle) {
    themeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!colorPopup) return;
      if (colorPopup.classList.contains('visible')) hideColorPopup();
      else showColorPopup();
    });
  }

  // live preview when input changes
  if (colorInput) {
    colorInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (!val) return;
      applyBackgroundColor(val);
    });
    // immediate save on 'Save'
    if (colorSaveBtn) colorSaveBtn.addEventListener('click', () => {
      const v = colorInput.value || DEFAULT_BG;
      try { localStorage.setItem(STORAGE_KEY, v); } catch (e) {}
      hideColorPopup();
    });
    // reset to default
    if (colorResetBtn) colorResetBtn.addEventListener('click', () => {
      const v = DEFAULT_BG;
      if (colorInput) colorInput.value = v;
      applyBackgroundColor(v);
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      hideColorPopup();
    });
  }

  /* ---------------- THEME (backwards compatibility) ---------------- */
  // Keep data-theme attribute in case any CSS relies on it; we won't change theme with the button anymore.
  (function initThemeAttribute() {
    const savedTheme = localStorage.getItem('site-theme');
    document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : 'dark');
  })();

  /* ---------------- rest of app (chapters, tooltips, image viewer, nav) -----------
     This code preserves all existing behaviors you had: chapter loading, "done" flag,
     slide-out chapters, tippy/banners with preloading, top/bottom nav (1s hide), image viewer,
     saving last-chapter-file, session-only scroll restore, etc.
     For brevity I keep the function structure from previously working script and insert
     color-picker initialization alongside existing init flows.
  -------------------------------------------------------------------------- */

  /* ---------------- HELPERS: done flag & nav ---------------- */
  function isDoneEntry(entry) { if (!entry) return false; return entry.done !== false; }
  function findPrevDoneIndex(fromIndex) {
    for (let i = (fromIndex === undefined ? currentIndex - 1 : fromIndex); i >= 0; i--) {
      if (isDoneEntry(chapters[i])) return i;
    }
    return -1;
  }
  function findNextDoneIndex(fromIndex) {
    for (let i = (fromIndex === undefined ? currentIndex + 1 : fromIndex); i < chapters.length; i++) {
      if (isDoneEntry(chapters[i])) return i;
    }
    return -1;
  }
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
    } else {
      [bottomPrev, topPrev].forEach(btn => { if (btn) { btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }});
    }

    if (!nextDisabled) {
      const n = chapters[nextIndex];
      [bottomNext, topNext].forEach(btn => { if (btn) { btn.dataset.index = nextIndex; btn.dataset.title = n.title || ''; }});
    } else {
      [bottomNext, topNext].forEach(btn => { if (btn) { btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }});
    }

    refreshNavTippies();
  }

  function goToChapter(index) {
    if (!chapters || index < 0 || index >= chapters.length) return;
    if (!isDoneEntry(chapters[index])) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    // scroll to top so reader can start fresh
    window.scrollTo({ top: 0, behavior: 'auto' });

    // Immediately show top nav when going to a new chapter and at top
    if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
    else clearHideTimer();

    closeChapters();

    // persist last-open chapter filename
    try { localStorage.setItem('last-chapter-file', c.file); } catch (e) {}
  }

  if (bottomPrev) bottomPrev.addEventListener('click', () => { const i = Number(bottomPrev.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (bottomNext) bottomNext.addEventListener('click', () => { const i = Number(bottomNext.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (topPrev) topPrev.addEventListener('click', () => { const i = Number(topPrev.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (topNext) topNext.addEventListener('click', () => { const i = Number(topNext.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });

  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if (e.key === 'ArrowLeft') {
      const prev = findPrevDoneIndex();
      if (prev !== -1) goToChapter(prev);
    }
    if (e.key === 'ArrowRight') {
      const next = findNextDoneIndex();
      if (next !== -1) goToChapter(next);
    }
  });

  /* ---------------- LOAD CHAPTER LIST ---------------- */
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
        if (!isDoneEntry(c)) {
          a.classList.add('undone');
        } else {
          a.addEventListener('click', (e) => { e.preventDefault(); goToChapter(i); });
        }
        li.appendChild(a);
        chaptersListEl.appendChild(li);
      });

      // restore last chapter (filename) if present
      const saved = localStorage.getItem('last-chapter-file');
      if (saved) {
        const idx = chapters.findIndex(ch => ch && ch.file === saved && isDoneEntry(ch));
        if (idx !== -1) {
          goToChapter(idx);
          return;
        }
      }

      const first = findFirstDoneIndex();
      if (first !== -1) goToChapter(first);
      else {
        chapterBodyEl.textContent = 'В репозитории нет доступных (done) глав.';
        updateNavButtons();
      }
    } catch (err) {
      chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message;
      console.error('loadChapters error:', err);
      [bottomPrev, bottomNext, topPrev, topNext].forEach(b => { if (b) b.disabled = true; });
    }
  }

  /* ---------------- LOAD SINGLE CHAPTER ---------------- */
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

      // Preload tooltip images for this chapter
      preloadTooltipImages();

      // initialize tippy (uses cached preloaded images)
      initGlossTippy();

      // bind inline images to viewer
      bindImagesToViewer();

      updateNavButtons();

      // Restore scroll only if a sessionStorage entry exists (reload), then remove it
      try {
        const key = 'scroll:' + filename;
        const v = sessionStorage.getItem(key);
        if (v !== null) {
          const scrollVal = Number(v) || 0;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.scrollTo({ top: scrollVal, behavior: 'auto' });
              try { sessionStorage.removeItem(key); } catch (e) {}
              if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
            });
          });
        } else {
          if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
        }
      } catch (e) {
        if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
      }

    } catch (err) {
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
      console.error('loadChapter error:', err);
    }
  }

  /* ---------------- IMAGE RESOLUTION / TEST ---------------- */
  function testImageUrl(url, timeout = 3000) {
    return new Promise((resolve) => {
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
      if (await testImageUrl(srcCandidate)) {
        resolvedUrlCache.set(srcCandidate, srcCandidate);
        return srcCandidate;
      }
    }

    const bases = [];
    bases.push(window.location.href);
    bases.push(window.location.origin + window.location.pathname);
    if (lastChapterFile) {
      bases.push(window.location.origin + '/' + lastChapterFile);
      const parts = lastChapterFile.split('/');
      parts.pop();
      const parent = parts.join('/');
      if (parent) bases.push(window.location.origin + '/' + parent + '/');
    }
    bases.push(window.location.origin + '/');

    const candidates = [];
    for (const base of bases) {
      try { const u = new URL(srcCandidate, base); candidates.push(u.href); } catch (e) { /* ignore */ }
    }

    const seen = new Set();
    const unique = candidates.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });

    for (const u of unique) {
      if (await testImageUrl(u)) {
        resolvedUrlCache.set(srcCandidate, u);
        return u;
      }
    }

    resolvedUrlCache.set(srcCandidate, null);
    return null;
  }

  /* ---------------- PRELOAD tooltip images ---------------- */
  async function preloadTooltipImages() {
    if (!chapterBodyEl) return;
    const glossEls = Array.from(chapterBodyEl.querySelectorAll('.gloss'));
    if (!glossEls.length) return;

    for (const el of glossEls) {
      const dataImg = el.getAttribute('data-img');
      if (!dataImg) continue;
      if (resolvedUrlCache.has(dataImg) && resolvedUrlCache.get(dataImg) === null) continue;

      try {
        const resolved = await resolveTooltipImage(dataImg);
        if (resolved) {
          if (preloadedImgCache.has(resolved)) continue;
          const pimg = new Image();
          pimg.crossOrigin = 'anonymous';
          pimg.decoding = 'async';
          preloadedImgCache.set(resolved, pimg);
          pimg.onload = () => { /* console.debug('preloaded', resolved) */ };
          pimg.onerror = () => { preloadedImgCache.delete(resolved); };
          pimg.src = resolved;
        }
      } catch (err) {
        // ignore
      }
    }
  }

  // re-preload on visibilitychange (browser might evict earlier image objects)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!chapterBodyEl) return;
      const glossEls = Array.from(chapterBodyEl.querySelectorAll('.gloss'));
      glossEls.forEach(async (el) => {
        const dataImg = el.getAttribute('data-img');
        if (!dataImg) return;
        const resolved = resolvedUrlCache.has(dataImg) ? resolvedUrlCache.get(dataImg) : await resolveTooltipImage(dataImg);
        if (resolved && (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete)) {
          try {
            const pimg = new Image();
            pimg.crossOrigin = 'anonymous';
            pimg.decoding = 'async';
            preloadedImgCache.set(resolved, pimg);
            pimg.onload = () => { /* console.debug('re-preloaded', resolved) */ };
            pimg.onerror = () => { preloadedImgCache.delete(resolved); };
            pimg.src = resolved;
          } catch (e) {}
        }
      });
    }
  });

  /* ---------------- TIPPY init for .gloss ---------------- */
  function initGlossTippy() {
    if (!window.tippy) return;
    document.querySelectorAll('.gloss').forEach(el => { try { if (el._tippy) el._tippy.destroy(); } catch (e) {} });

    tippy('.gloss', {
      allowHTML: true, interactive: true, delay: [60, 80], maxWidth: 520, placement: 'top', offset: [0, 8],
      appendTo: () => document.body,
      popperOptions: {
        strategy: 'fixed',
        modifiers: [
          { name: 'computeStyles', options: { adaptive: false } },
          { name: 'preventOverflow', options: { padding: 8, altAxis: true } },
          { name: 'flip', options: { fallbackPlacements: ['bottom', 'right', 'left'] } }
        ]
      },
      content: 'Loading...',
      onShow: async (instance) => {
        const reference = instance.reference;
        let contentHTML = reference.getAttribute('data-tippy-content') || reference.getAttribute('data-tip') || reference.getAttribute('title') || reference.innerHTML || '';
        if (reference.getAttribute('title')) reference.removeAttribute('title');

        const dataImg = reference.getAttribute('data-img');
        const imgAlt = reference.getAttribute('data-img-alt') || '';

        const wrapper = document.createElement('div');

        let resolved = null;
        if (dataImg) {
          if (resolvedUrlCache.has(dataImg)) resolved = resolvedUrlCache.get(dataImg);
          else resolved = await resolveTooltipImage(dataImg);
        }

        if (resolved) {
          // ensure preloaded img exists
          if (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete) {
            try {
              const pimg = new Image();
              pimg.crossOrigin = 'anonymous';
              pimg.decoding = 'async';
              preloadedImgCache.set(resolved, pimg);
              pimg.onload = () => {};
              pimg.onerror = () => { preloadedImgCache.delete(resolved); };
              pimg.src = resolved;
            } catch (e) {}
          }

          const imgEl = document.createElement('img');
          imgEl.className = 'tooltip-img';
          imgEl.src = resolved;
          imgEl.alt = imgAlt;
          imgEl.loading = 'eager';
          imgEl.style.cursor = 'pointer';
          imgEl.addEventListener('click', (ev) => {
            ev.stopPropagation();
            try { openImageViewer(resolved, imgAlt); } catch (e) { }
            try { instance.hide(); } catch (e) { }
          });
          imgEl.addEventListener('load', () => {
            try {
              if (instance.popperInstance && typeof instance.popperInstance.update === 'function') instance.popperInstance.update();
              else if (typeof instance.update === 'function') instance.update();
            } catch (e) {}
          });

          wrapper.appendChild(imgEl);
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'tooltip-body';
        contentDiv.innerHTML = contentHTML;
        wrapper.appendChild(contentDiv);

        try { instance.setContent(wrapper); } catch (e) { instance.setContent(wrapper.outerHTML); }
      }
    });
  }

  /* ---------------- nav tippies ---------------- */
  function refreshNavTippies() {
    if (!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if (!btn) return; try { if (btn._tippy) btn._tippy.destroy(); } catch (e) {} });
    if (bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
  }

  /* ---------------- Chapters aside slide behavior ---------------- */
  let chaptersOpen = false;
  const EDGE_TRIGGER_PX = 12;
  function openChapters() { if (chaptersOpen) return; chaptersOpen = true; document.body.classList.add('chapters-open'); }
  function closeChapters() { if (!chaptersOpen) return; chaptersOpen = false; document.body.classList.remove('chapters-open'); }

  document.addEventListener('mousemove', (e) => { if (window.innerWidth <= 700) return; if (e.clientX <= EDGE_TRIGGER_PX) openChapters(); });
  if (chaptersAside) {
    chaptersAside.addEventListener('mouseenter', openChapters);
    chaptersAside.addEventListener('mouseleave', (ev) => { if (ev.clientX <= EDGE_TRIGGER_PX) return; closeChapters(); });
  }
  document.addEventListener('click', (e) => { if (!chaptersOpen) return; if (chaptersAside && chaptersAside.contains(e.target)) return; if (e.clientX <= EDGE_TRIGGER_PX) return; closeChapters(); });

  /* ---------------- Top nav visibility (1s hide delay, immediate show at top) ---------------- */
  function positionTopNav() {
    if (!topNav || !headerEl) return;
    const hRect = headerEl.getBoundingClientRect();
    const topNavRect = topNav.getBoundingClientRect();
    const top = Math.max(6, hRect.top + (hRect.height / 2) - (topNavRect.height / 2));
    topNav.style.top = `${top}px`;
  }

  let lastScrollY = window.scrollY;
  let scheduled = false;
  let hideDelayTimer = null;
  const HIDE_DELAY_MS = 1000; // one second

  function clearHideTimer() {
    if (hideDelayTimer) { clearTimeout(hideDelayTimer); hideDelayTimer = null; }
  }

  function bottomNavIsVisible() {
    if (!bottomNav) return false;
    const r = bottomNav.getBoundingClientRect();
    return (r.top < window.innerHeight) && (r.bottom > 0);
  }

  function showTopNavImmediate() {
    if (bottomNavIsVisible()) { hideTopNavImmediate(); return; }
    if (!topNav) return;
    topNav.classList.add('visible-top');
    topNav.setAttribute('aria-hidden', 'false');
    clearHideTimer();
  }

  function hideTopNavImmediate() {
    if (!topNav) return;
    topNav.classList.remove('visible-top');
    topNav.setAttribute('aria-hidden', 'true');
    clearHideTimer();
  }

  function scheduleHideTopNav() {
    if (hideDelayTimer) return;
    hideDelayTimer = setTimeout(() => {
      if (!bottomNavIsVisible()) hideTopNavImmediate();
      hideDelayTimer = null;
    }, HIDE_DELAY_MS);
  }

  function onScrollCheck() {
    const curY = window.scrollY;
    const scrollingUp = curY < lastScrollY;
    const atTop = curY <= 10;

    if (bottomNavIsVisible()) {
      hideTopNavImmediate();
      clearHideTimer();
    } else if (atTop || scrollingUp) {
      clearHideTimer();
      showTopNavImmediate();
    } else {
      scheduleHideTopNav();
    }
    lastScrollY = curY;
  }

  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { onScrollCheck(); scheduled = false; });
  }, { passive: true });

  window.addEventListener('resize', () => { positionTopNav(); onScrollCheck(); });

  const observer = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(en => en.isIntersecting);
    if (anyVisible) hideTopNavImmediate();
  }, { root: null, threshold: 0.01 });

  if (bottomNav) observer.observe(bottomNav);

  function initialTopNavSetup() {
    positionTopNav();
    if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
    else hideTopNavImmediate();
  }
  initialTopNavSetup();
  setTimeout(initialTopNavSetup, 80);

  /* ---------------- Image viewer ---------------- */
  if (!document.getElementById('image-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'image-overlay';
    overlay.innerHTML = `<div class="viewer" role="dialog" aria-modal="true"><img class="viewer-img" src="" alt=""></div>`;
    document.body.appendChild(overlay);
  }
  const overlay = document.getElementById('image-overlay');
  const overlayImg = overlay.querySelector('.viewer-img');

  let isZoomed = false;
  let pointerDown = false;
  let pointerStart = { x: 0, y: 0 };
  let imgPos = { x: 0, y: 0 };
  let dragMoved = false;
  let suppressClick = false;
  const DRAG_THRESHOLD = 4;

  function openImageViewer(src, alt = '') {
    overlayImg.src = src;
    overlayImg.alt = alt || '';
    const marginPx = 40;
    overlayImg.style.maxWidth = `calc(100vw - ${marginPx}px)`;
    overlayImg.style.maxHeight = `calc(100vh - ${Math.round(marginPx * 1.5)}px)`;
    overlay.classList.add('visible');
    isZoomed = false;
    imgPos = { x: 0, y: 0 };
    overlayImg.style.transform = `translate(0px, 0px) scale(1)`;
    overlayImg.classList.remove('zoomed');
    overlay.style.cursor = 'default';
    document.body.style.overflow = 'hidden';
    const viewer = overlay.querySelector('.viewer');
    if (viewer) { viewer.scrollTop = 0; viewer.scrollLeft = 0; }
  }

  function closeImageViewer() {
    overlay.classList.remove('visible');
    overlayImg.src = '';
    isZoomed = false;
    pointerDown = false;
    dragMoved = false;
    suppressClick = false;
    document.body.style.overflow = '';
    overlayImg.style.maxWidth = '';
    overlayImg.style.maxHeight = '';
  }

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
    if (!isZoomed) return;
    ev.preventDefault();
    pointerDown = true;
    dragMoved = false;
    pointerStart = { x: ev.clientX, y: ev.clientY };
    overlayImg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (ev) => {
    if (!pointerDown || !isZoomed) return;
    const dx = ev.clientX - pointerStart.x;
    const dy = ev.clientY - pointerStart.y;
    if (!dragMoved && (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD)) dragMoved = true;
    if (dragMoved) {
      pointerStart = { x: ev.clientX, y: ev.clientY };
      imgPos.x += dx;
      imgPos.y += dy;
      applyImageTransform();
    }
  });

  window.addEventListener('mouseup', (ev) => {
    if (pointerDown && dragMoved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    pointerDown = false;
    overlayImg.style.cursor = isZoomed ? 'grab' : 'zoom-in';
  });

  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeImageViewer(); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && overlay.classList.contains('visible')) closeImageViewer(); });

  function bindImagesToViewer() {
    const imgs = chapterBodyEl.querySelectorAll('img');
    imgs.forEach(img => {
      const clone = img.cloneNode(true);
      clone.style.cursor = 'pointer';
      img.parentNode.replaceChild(clone, img);
      clone.addEventListener('click', (e) => {
        const src = clone.getAttribute('src') || clone.getAttribute('data-src') || '';
        if (!src) return;
        openImageViewer(src, clone.getAttribute('alt') || '');
      });
    });
  }

  /* ---------------- Persist scroll only on unload (sessionStorage) ---------------- */
  window.addEventListener('beforeunload', () => {
    try {
      if (currentIndex >= 0 && chapters[currentIndex] && chapters[currentIndex].file) {
        const key = 'scroll:' + chapters[currentIndex].file;
        sessionStorage.setItem(key, String(window.scrollY || 0));
      }
    } catch (e) {}
  });

  /* ---------------- Utility: tippies & nav initialization ---------------- */
  function refreshNavTippies() {
    if (!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if (!btn) return; try { if (btn._tippy) btn._tippy.destroy(); } catch (e) {} });
    if (bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
  }

  /* ---------------- START ---------------- */

  // init color picker and apply saved color immediately
  initColorPicker();

  // then load chapters etc
  loadChapters();
  updateNavButtons();

  // ensure top nav position & visibility correct after page load
  setTimeout(() => { positionTopNav(); if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); }, 120);

});
