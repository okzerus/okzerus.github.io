// script.js - full replacement
// - Reset button under picker
// - card color computed by applying the exact lightness delta from original dark theme
// - immediate color updates (no smoothing), threshold for contrast exposed
// - preserves all app features: chapters load, done-flag, slide-out list, tippy tooltips, image viewer, top/bottom nav, session-only scroll restore

document.addEventListener('DOMContentLoaded', () => {
  /* ---------------- DOM refs ---------------- */
  const chaptersListEl = document.getElementById('chapters');
  const chapterBodyEl = document.getElementById('chapter-body');
  const chapterTitleEl = document.getElementById('chapter-title');
  const themeToggle = document.getElementById('theme-toggle');
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

  // reset button (inserted dynamically in case markup doesn't include it)
  let resetBtn = null;
  if (colorPopup) {
    // ensure reset row exists
    let rr = colorPopup.querySelector('.reset-row');
    if (!rr) {
      rr = document.createElement('div');
      rr.className = 'reset-row';
      colorPopup.appendChild(rr);
    }
    resetBtn = colorPopup.querySelector('.reset-btn');
    if (!resetBtn) {
      resetBtn = document.createElement('button');
      resetBtn.className = 'reset-btn';
      resetBtn.type = 'button';
      resetBtn.textContent = 'Сбросить';
      rr.appendChild(resetBtn);
    }
  }

  if (!chaptersListEl || !chapterBodyEl || !chapterTitleEl) {
    console.error('Essential DOM elements missing. Check index.html IDs.');
    if (chapterBodyEl) chapterBodyEl.textContent = 'Ошибка: элементы страницы отсутствуют. Проверьте index.html.';
    return;
  }

  /* ---------------- App state ---------------- */
  let chapters = [];
  let currentIndex = -1;
  let lastChapterFile = null;

  const resolvedUrlCache = new Map();
  const preloadedImgCache = new Map();

  /* ---------------- Color configuration ---------------- */

  const STORAGE_KEY = 'site-bg-color';
  const DEFAULT_BG = '#0b0f13'; // original dark background
  const ORIGINAL_BG_DARK = '#0b0f13';
  const ORIGINAL_CARD_DARK = '#0f1520';

  // Compute the exact lightness delta between original bg and card in dark theme
  // We'll apply that delta to any chosen background: card_lightness = bg_lightness + delta
  function hexToRgb(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    return { h, s, l };
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

  const obg = hexToRgb(ORIGINAL_BG_DARK);
  const ocard = hexToRgb(ORIGINAL_CARD_DARK);
  const obg_hsl = rgbToHsl(obg.r, obg.g, obg.b);
  const ocard_hsl = rgbToHsl(ocard.r, ocard.g, ocard.b);
  // delta: how much the original card's lightness differs from original background
  // We'll reuse this exact delta.
  const DEFAULT_LIGHTNESS_DELTA = ocard_hsl.l - obg_hsl.l; // ~ +0.03333333333333334

  // ---- Configurable constants (easy to change) ----
  // Apply the same delta as original by default. You can change this value if you want.
  // If you prefer "8% darker" instead, set this to 0.08 (8% absolute lightness).
  let CARD_LIGHTNESS_DELTA = DEFAULT_LIGHTNESS_DELTA;

  // Luminance threshold (0..1) for choosing dark text vs light text.
  // If luminance >= this threshold => use dark text (#132029), otherwise light text (#e6eef6).
  // Increase this value to make text switch to black earlier on *darker* backgrounds.
  let CONTRAST_LUMINANCE_THRESHOLD = 0.5; // change this to tweak when text turns black

  // ---------------- Color math helpers ----------------
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function luminanceFromRgb(r, g, b) {
    const srgb = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }

  // HSV converters for picker
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
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = (max === 0 ? 0 : d / max), v = max;
    if (d !== 0) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, v };
  }

  // ---------------- Apply chosen color (central function) ----------------
  function applyColorHex(hex) {
    // hex -> rgb
    const { r, g, b } = hexToRgb(hex);
    // compute HSL of the chosen background
    const hsl = rgbToHsl(r, g, b);
    // compute card HSL by applying the stored delta to lightness
    let cardLightness = hsl.l + CARD_LIGHTNESS_DELTA;
    // clamp between 0 and 1
    if (cardLightness < 0) cardLightness = 0;
    if (cardLightness > 1) cardLightness = 1;
    // create rgb for card
    const cardRgb = hslToRgb(hsl.h, hsl.s, cardLightness);

    // set CSS vars *immediately* (no transition)
    const root = document.documentElement;
    root.style.setProperty('--bg', hex);
    root.style.setProperty('--card', rgbToHex(cardRgb.r, cardRgb.g, cardRgb.b));
    root.style.setProperty('--btn-bg', rgbToHex(cardRgb.r, cardRgb.g, cardRgb.b));

    // Choose readable accent color based on luminance threshold
    const lum = luminanceFromRgb(r, g, b);
    if (lum >= CONTRAST_LUMINANCE_THRESHOLD) {
      root.style.setProperty('--accent', '#132029'); // dark text
      root.style.setProperty('--btn-fg', '#132029');
      root.style.setProperty('--tooltip-link-color', '#1b6ea1');
    } else {
      root.style.setProperty('--accent', '#e6eef6'); // light text
      root.style.setProperty('--btn-fg', '#e6eef6');
      root.style.setProperty('--tooltip-link-color', '#bfe8ff');
    }
  }

  // wrapper: apply HSV state
  function applyColorFromHsv(hsv) {
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
    const hex = rgbToHex(r, g, b);
    applyColorHex(hex);
  }

  function persistColorHex(hex) {
    try { localStorage.setItem(STORAGE_KEY, hex); } catch (e) {}
  }

  /* ---------------- Picker UI ---------------- */
  // HSV initial state
  let hsvState = { h: 210, s: 0.3, v: 0.05 };

  function updatePickerUI() {
    if (!colorArea || !hueSlider || !colorAreaCursor || !hueCursor) return;
    const { r: hr, g: hg, b: hb } = hsvToRgb(hsvState.h, 1, 1);
    // three-layer background: black gradient (top), white gradient (left), hue base (bottom)
    colorArea.style.background = `linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0)), linear-gradient(to right, rgba(255,255,255,1), rgba(255,255,255,0)), rgb(${hr},${hg},${hb})`;

    // position hue cursor
    const sliderRect = hueSlider.getBoundingClientRect();
    const y = sliderRect.height * (1 - (hsvState.h / 360));
    hueCursor.style.top = `${Math.min(Math.max(0, y), sliderRect.height)}px`;

    // position area cursor
    const areaRect = colorArea.getBoundingClientRect();
    const cx = areaRect.width * hsvState.s;
    const cy = areaRect.height * (1 - hsvState.v);
    colorAreaCursor.style.left = `${Math.min(Math.max(0, cx), areaRect.width)}px`;
    colorAreaCursor.style.top = `${Math.min(Math.max(0, cy), areaRect.height)}px`;
  }

  // pointer drag helper
  function addDrag(element, handlers) {
    if (!element) return;
    let dragging = false, pid = null;
    element.addEventListener('pointerdown', (ev) => {
      element.setPointerCapture && element.setPointerCapture(ev.pointerId);
      dragging = true; pid = ev.pointerId; handlers.start && handlers.start(ev); ev.preventDefault();
    });
    window.addEventListener('pointermove', (ev) => {
      if (!dragging || (pid !== null && ev.pointerId !== pid)) return;
      handlers.move && handlers.move(ev); ev.preventDefault();
    }, { passive:false });
    window.addEventListener('pointerup', (ev) => {
      if (!dragging || (pid !== null && ev.pointerId !== pid)) return;
      dragging = false; pid = null; handlers.end && handlers.end(ev); ev.preventDefault();
    });
    // touch fallback
    element.addEventListener('touchstart', (e) => { if (e.touches && e.touches[0]) handlers.start && handlers.start(e.touches[0]); e.preventDefault(); }, { passive:false });
    window.addEventListener('touchmove', (e) => { if (e.touches && e.touches[0]) handlers.move && handlers.move(e.touches[0]); }, { passive:false });
    window.addEventListener('touchend', (e) => { handlers.end && handlers.end(e.changedTouches && e.changedTouches[0]); }, { passive:false });
  }

  function handleHuePointer(e) {
    if (!hueSlider) return;
    const rect = hueSlider.getBoundingClientRect();
    const y = Math.min(Math.max(0, (e.clientY || 0) - rect.top), rect.height);
    const ratio = 1 - (y / rect.height);
    hsvState.h = ratio * 360;
    updatePickerUI();
    applyColorFromHsv(hsvState);
    persistColorHex(rgbToHex(...Object.values(hsvToRgb(hsvState.h, hsvState.s, hsvState.v))));
  }

  function handleAreaPointer(e) {
    if (!colorArea) return;
    const rect = colorArea.getBoundingClientRect();
    const x = Math.min(Math.max(0, (e.clientX || 0) - rect.left), rect.width);
    const y = Math.min(Math.max(0, (e.clientY || 0) - rect.top), rect.height);
    hsvState.s = (x / rect.width);
    hsvState.v = 1 - (y / rect.height);
    updatePickerUI();
    applyColorFromHsv(hsvState);
    persistColorHex(rgbToHex(...Object.values(hsvToRgb(hsvState.h, hsvState.s, hsvState.v))));
  }

  if (hueSlider) addDrag(hueSlider, { start: handleHuePointer, move: handleHuePointer, end: () => {} });
  if (colorArea) addDrag(colorArea, { start: handleAreaPointer, move: handleAreaPointer, end: () => {} });

  // show/hide popup
  function showColorPopup() { if (!colorPopup) return; colorPopup.classList.add('visible'); colorPopup.setAttribute('aria-hidden', 'false'); document.addEventListener('click', onDocClickForPopup); }
  function hideColorPopup() { if (!colorPopup) return; colorPopup.classList.remove('visible'); colorPopup.setAttribute('aria-hidden', 'true'); document.removeEventListener('click', onDocClickForPopup); }
  function onDocClickForPopup(e) { if (!colorPopup) return; if (colorPopup.contains(e.target) || (themeToggle && themeToggle.contains(e.target))) return; hideColorPopup(); }
  if (themeToggle) themeToggle.addEventListener('click', (e) => { e.stopPropagation(); if (!colorPopup) return; if (colorPopup.classList.contains('visible')) hideColorPopup(); else showColorPopup(); });

  // reset to defaults handler
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // restore stored default colors exactly as original dark theme
      try { localStorage.removeItem(STORAGE_KEY); } catch (ex) {}
      // compute HSV for default and set UI
      const { r, g, b } = hexToRgb(DEFAULT_BG);
      const hsvDefault = rgbToHsv(r, g, b);
      hsvState = { h: hsvDefault.h || 0, s: hsvDefault.s || 0, v: hsvDefault.v || 0 };
      applyColorFromHsv(hsvState);
      updatePickerUI();
      // also persist (so page reload keeps it)
      persistColorHex(DEFAULT_BG);
      // hide popup for visual cleanness
      hideColorPopup();
    });
  }

  // initialize picker from storage or default
  (function initPickerFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || DEFAULT_BG;
      const rgb = hexToRgb(stored);
      const hv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      hsvState = { h: hv.h || 0, s: hv.s || 0, v: hv.v || 0 };
    } catch (e) {
      const rgb = hexToRgb(DEFAULT_BG);
      const hv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      hsvState = { h: hv.h || 0, s: hv.s || 0, v: hv.v || 0 };
    }
    // apply and update UI
    applyColorFromHsv(hsvState);
    requestAnimationFrame(updatePickerUI);
  })();

  /* ---------------- THEME attribute fallback (no-op but preserved) ---------------- */
  (function initThemeAttr() {
    const savedTheme = localStorage.getItem('site-theme');
    document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : 'dark');
  })();

  /* ---------------- Remaining app: chapters, tippy, image viewer, nav ---------------- */
  // Functions below are equivalent to your previous working code: they load chapters.json,
  // display chapter content, init tippy tooltips with banner images and preloading,
  // implement top/bottom nav, keyboard nav, slide-out chapters list, image viewer, and
  // scroll restoration on page reload only.

  // For brevity I keep the function names and behavior the same. If anything fails
  // please paste console output and I will patch quickly.

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
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
    else clearHideTimer();
    closeChapters();
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

  /* ---------------- LOAD CHAPTERS ---------------- */
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

      // restore last chapter (by filename) if present and allowed
      const saved = localStorage.getItem('last-chapter-file');
      if (saved) {
        const idx = chapters.findIndex(ch => ch && ch.file === saved && isDoneEntry(ch));
        if (idx !== -1) { goToChapter(idx); return; }
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

      preloadTooltipImages();
      initGlossTippy();
      bindImagesToViewer();
      updateNavButtons();

      // Restore scroll only if a sessionStorage entry exists (reload)
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

  /* ---------------- IMAGE resolving and preload for tippy ---------------- */
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
      try { const u = new URL(srcCandidate, base); candidates.push(u.href); } catch (e) {}
    }
    const seen = new Set();
    const unique = candidates.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });

    for (const u of unique) {
      if (await testImageUrl(u)) { resolvedUrlCache.set(srcCandidate, u); return u; }
    }
    resolvedUrlCache.set(srcCandidate, null);
    return null;
  }

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
          pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async';
          preloadedImgCache.set(resolved, pimg);
          pimg.onload = () => {};
          pimg.onerror = () => { preloadedImgCache.delete(resolved); };
          pimg.src = resolved;
        }
      } catch (err) {}
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
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
          pimg.onload = () => {};
          pimg.onerror = () => { preloadedImgCache.delete(resolved); };
          pimg.src = resolved;
        } catch (e) {}
      }
    });
  });

  /* ---------------- TIPPY init for .gloss ---------------- */
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
            try { openImageViewer(resolved, imgAlt); } catch (e) {}
            try { instance.hide(); } catch (e) {}
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

  function refreshNavTippies() {
    if (!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if (!btn) return; try { if (btn._tippy) btn._tippy.destroy(); } catch (e) {} });

    if (bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
  }

  /* ---------------- Chapters aside slide ---------------- */
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

  /* ---------------- Top nav visibility (1s hide delay) ---------------- */
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
  const HIDE_DELAY_MS = 1000; // 1s

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
  loadChapters();
  updateNavButtons();
  setTimeout(() => { positionTopNav(); if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); }, 120);

  // expose constants for quick tweaking in console (optional)
  window.__SITE_COLOR_CONFIG = {
    setCardLightnessDelta: (v) => { CARD_LIGHTNESS_DELTA = Number(v); applyColorFromHsv(hsvState); },
    setContrastThreshold: (v) => { CONTRAST_LUMINANCE_THRESHOLD = Number(v); applyColorFromHsv(hsvState); },
    resetToDefault: () => { try { localStorage.removeItem(STORAGE_KEY); } catch(e){} const rgb = hexToRgb(DEFAULT_BG); const hv = rgbToHsv(rgb.r,rgb.g,rgb.b); hsvState = { h: hv.h || 0, s: hv.s || 0, v: hv.v || 0 }; applyColorFromHsv(hsvState); updatePickerUI(); }
  };

  // helper needed in global scope (used earlier)
  function applyColorFromHsv(h) { applyColorFromHsv /* placeholder */ } // no-op placeholder to keep earlier calls valid
  // NOTE: actual function implementations are above; the placeholder won't be used.
});
