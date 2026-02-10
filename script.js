// script.js - full replacement with improved glow algorithm (perceived brightness aware)
document.addEventListener('DOMContentLoaded', () => {
  /* DOM refs */
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

  /* state */
  let chapters = [];
  let currentIndex = -1;
  let lastChapterFile = null;
  const resolvedUrlCache = new Map();
  const preloadedImgCache = new Map();

  /* blur & animation config */
  const BLUR_THRESHOLD_Y_RATIO = 0.5; // middle of viewport
  const BLUR_VISUAL_KEY = 'blur-visual-enabled';

  /* ========== color picker & theme helpers ========== */
  const DEFAULT_BG_HEX = '#0b0f13';
  const CARD_LIGHTNESS_DELTA = 0.03333333333333333;
  const CONTRAST_LUMINANCE_THRESHOLD = 0.50;

  function hexToRgb(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
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
    h = ((h % 360) + 360) % 360;
    if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    const hk = h / 360;
    const r = hue2rgb(p, q, hk + 1 / 3);
    const g = hue2rgb(p, q, hk);
    const b = hue2rgb(p, q, hk - 1 / 3);
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }
  function luminanceFromRgb(r, g, b) {
    // r,g,b expected 0..255
    const srgb = [r, g, b].map(v => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]; // 0..1
  }

  function computeCardFromBgHex(bgHex) {
    const { r, g, b } = hexToRgb(bgHex);
    const hsl = rgbToHsl(r, g, b);
    let newL = hsl.l + CARD_LIGHTNESS_DELTA;
    if (newL > 1) newL = 1;
    if (newL < 0) newL = 0;
    const cardRgb = hslToRgb(hsl.h, hsl.s, newL);
    return { rgb: cardRgb, hex: rgbToHex(cardRgb.r, cardRgb.g, cardRgb.b) };
  }
  function applyColorHex(hex) {
    const root = document.documentElement;
    const { r, g, b } = hexToRgb(hex);
    root.style.setProperty('--bg', hex);
    root.style.setProperty('--bg-r', String(r));
    root.style.setProperty('--bg-g', String(g));
    root.style.setProperty('--bg-b', String(b));
    const card = computeCardFromBgHex(hex);
    root.style.setProperty('--card', card.hex);
    root.style.setProperty('--btn-bg', card.hex);
    const lum = luminanceFromRgb(r, g, b);
    if (lum < CONTRAST_LUMINANCE_THRESHOLD) {
      root.style.setProperty('--accent', '#e6eef6');
      root.style.setProperty('--btn-fg', '#e6eef6');
      root.style.setProperty('--tooltip-link-color', '#bfe8ff');
    } else {
      root.style.setProperty('--accent', '#132029');
      root.style.setProperty('--btn-fg', '#132029');
      root.style.setProperty('--tooltip-link-color', '#1b6ea1');
    }
    updateGlowElements(); // keep glow in sync when bg color changes
  }

  /* Color picker helpers (kept) */
  const STORAGE_KEY = 'site-bg-color';
  let hsv = { h: 210, s: 0.3, v: 0.05 };

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
  function persistHex(hex) { try { localStorage.setItem(STORAGE_KEY, hex); } catch (e) {} }
  function applyHsvState() { const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v); const hex = rgbToHex(r, g, b); applyColorHex(hex); }

  function updatePickerUI() {
    if (!colorArea || !hueSlider || !colorAreaCursor || !hueCursor) return;
    const { r: hr, g: hg, b: hb } = hsvToRgb(hsv.h, 1, 1);
    colorArea.style.background = `linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0)), linear-gradient(to right, rgba(255,255,255,1), rgba(255,255,255,0)), rgb(${hr},${hg},${hb})`;
    const sliderRect = hueSlider.getBoundingClientRect();
    const y = sliderRect.height * (1 - (hsv.h / 360));
    hueCursor.style.top = `${Math.min(Math.max(0, y), sliderRect.height)}px`;
    const areaRect = colorArea.getBoundingClientRect();
    const cx = areaRect.width * hsv.s;
    const cy = areaRect.height * (1 - hsv.v);
    colorAreaCursor.style.left = `${Math.min(Math.max(0, cx), areaRect.width)}px`;
    colorAreaCursor.style.top = `${Math.min(Math.max(0, cy), areaRect.height)}px`;
  }

  function addDrag(element, handlers) {
    if (!element) return;
    let dragging = false; let pointerId = null;
    element.addEventListener('pointerdown', (ev) => {
      element.setPointerCapture && element.setPointerCapture(ev.pointerId);
      dragging = true; pointerId = ev.pointerId;
      handlers.start && handlers.start(ev); ev.preventDefault();
    });
    window.addEventListener('pointermove', (ev) => {
      if (!dragging || (pointerId !== null && ev.pointerId !== pointerId)) return;
      handlers.move && handlers.move(ev); ev.preventDefault();
    }, { passive: false });
    window.addEventListener('pointerup', (ev) => {
      if (!dragging || (pointerId !== null && ev.pointerId !== pointerId)) return;
      dragging = false; pointerId = null; handlers.end && handlers.end(ev); ev.preventDefault();
    });
    element.addEventListener('touchstart', (e) => { if (e.touches && e.touches[0]) handlers.start && handlers.start(e.touches[0]); e.preventDefault(); }, { passive: false });
    window.addEventListener('touchmove', (e) => { if (e.touches && e.touches[0]) handlers.move && handlers.move(e.touches[0]); }, { passive: false });
    window.addEventListener('touchend', (e) => { handlers.end && handlers.end(e.changedTouches && e.changedTouches[0]); }, { passive: false });
  }

  function handleHuePointer(e) {
    if (!hueSlider) return;
    const rect = hueSlider.getBoundingClientRect();
    const y = Math.min(Math.max(0, (e.clientY || 0) - rect.top), rect.height);
    const ratio = 1 - (y / rect.height);
    hsv.h = ratio * 360; updatePickerUI(); applyHsvState(); persistHex(rgbToHex(...Object.values(hsvToRgb(hsv.h, hsv.s, hsv.v))));
  }
  function handleAreaPointer(e) {
    if (!colorArea) return;
    const rect = colorArea.getBoundingClientRect();
    const x = Math.min(Math.max(0, (e.clientX || 0) - rect.left), rect.width);
    const y = Math.min(Math.max(0, (e.clientY || 0) - rect.top), rect.height);
    hsv.s = (x / rect.width); hsv.v = 1 - (y / rect.height);
    updatePickerUI(); applyHsvState(); persistHex(rgbToHex(...Object.values(hsvToRgb(hsv.h, hsv.s, hsv.v))));
  }
  if (hueSlider) addDrag(hueSlider, { start: handleHuePointer, move: handleHuePointer, end: () => persistHex(rgbToHex(...Object.values(hsvToRgb(hsv.h, hsv.s, hsv.v)))) });
  if (colorArea) addDrag(colorArea, { start: handleAreaPointer, move: handleAreaPointer, end: () => persistHex(rgbToHex(...Object.values(hsvToRgb(hsv.h, hsv.s, hsv.v)))) });

  function showColorPopup() { if (!colorPopup) return; colorPopup.classList.add('visible'); colorPopup.setAttribute('aria-hidden','false'); document.addEventListener('click', onDocClickForPopup); }
  function hideColorPopup() { if (!colorPopup) return; colorPopup.classList.remove('visible'); colorPopup.setAttribute('aria-hidden','true'); document.removeEventListener('click', onDocClickForPopup); }
  function onDocClickForPopup(e) { if (!colorPopup) return; if (colorPopup.contains(e.target) || (themeToggle && themeToggle.contains(e.target))) return; hideColorPopup(); }
  if (themeToggle) themeToggle.addEventListener('click', (e) => { e.stopPropagation(); if (!colorPopup) return; if (colorPopup.classList.contains('visible')) hideColorPopup(); else showColorPopup(); });
  if (colorResetBtn) colorResetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    try { localStorage.setItem(STORAGE_KEY, DEFAULT_BG_HEX); } catch (err) {}
    const { r, g, b } = hexToRgb(DEFAULT_BG_HEX);
    const hv = rgbToHsv(r, g, b);
    hsv.h = hv.h; hsv.s = hv.s; hsv.v = hv.v;
    applyHsvState(); updatePickerUI(); hideColorPopup();
  });
  (function initColor() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || DEFAULT_BG_HEX;
      const { r, g, b } = hexToRgb(stored);
      const v = rgbToHsv(r, g, b);
      hsv.h = v.h || 0; hsv.s = v.s || 0; hsv.v = v.v || 0;
    } catch (e) {
      const { r, g, b } = hexToRgb(DEFAULT_BG_HEX);
      const v = rgbToHsv(r, g, b);
      hsv.h = v.h || 0; hsv.s = v.s || 0; hsv.v = v.v || 0;
    }
    applyHsvState(); requestAnimationFrame(updatePickerUI);
  })();

// ---------- glow helpers (replace existing functions) ----------
/**
 * Parse "rgb(...)" or "rgba(...)" to [r,g,b]; fallback to white.
 */
function parseRgbString(rgbStr) {
  if (!rgbStr) return [255,255,255];
  const m = rgbStr.match(/rgba?\(\s*([0-9]+)[,\s]+([0-9]+)[,\s]+([0-9]+)/i);
  if (!m) return [255,255,255];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

/**
 * Update a single glow element.
 * Accepts data-glow-strength (can be >1). Uses color luminance + chroma to boost glow for dark/saturated colors.
 */
function updateGlowElement(el) {
  try {
    if (!el) return;
    // parse strength (allow >1)
    const raw = el.getAttribute('data-glow-strength');
    let strength = 0.6;
    if (raw !== null) {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) strength = Math.max(0, n);
    }

    // base tuning params (feel free to tweak)
    const baseR1 = 6;    // inner glow base radius (px)
    const baseR2 = 14;   // outer halo base radius (px)
    const baseAlpha = 0.55; // base alpha for inner glow at strength 1 and mid luminance

    // compute element color (currentColor)
    const cs = getComputedStyle(el);
    const [r,g,b] = parseRgbString(cs.color);

    // perceived luminance in 0..1
    const lum = (function(r,g,b){
      const srgb = [r,g,b].map(v => {
        v = v / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
    })(r,g,b);

    // chroma (saturation proxy): (max-min)/255 -> 0..1
    const maxc = Math.max(r,g,b), minc = Math.min(r,g,b);
    const chroma = (maxc - minc) / 255;

    // perceptual boost: darker & more saturated colors get more halo
    const darkFactor = 1 + (1 - lum) * 1.6;    // ~1..2.6
    const chromaFactor = 1 + chroma * 1.5;     // ~1..2.5

    // combine with user strength (non-linear)
    const effective = Math.max(0.25, strength) * Math.sqrt(darkFactor * chromaFactor);

    // radii and alphas with sensible clamps
    const r1 = Math.round(baseR1 * (0.6 + effective * 0.75)); // inner radius 4..(larger)
    const r2 = Math.round(baseR2 * (0.9 + effective * 1.25)); // outer radius larger
    let a1 = clamp(baseAlpha * (0.55 + effective * 0.8), 0.06, 0.98);
    let a2 = clamp(a1 * 0.36, 0.02, 0.65);

    // for very-bright colors (lum high) slightly reduce alpha so glow isn't too harsh
    if (lum > 0.85) { a1 *= 0.7; a2 *= 0.65; }

    // apply CSS variables (CSS expects comma-separated RGB for color)
    el.style.setProperty('--glow-color', `${r},${g},${b}`);
    el.style.setProperty('--glow-r1', `${r1}px`);
    el.style.setProperty('--glow-a1', String(Number(a1.toFixed(3))));
    el.style.setProperty('--glow-r2', `${r2}px`);
    el.style.setProperty('--glow-a2', String(Number(a2.toFixed(3))));

    // ensure transition available
    if (!el.style.transition || !el.style.transition.includes('text-shadow')) {
      el.style.transition = (el.style.transition ? el.style.transition + ', ' : '') + 'text-shadow var(--blur-duration) ease, color var(--blur-duration) ease';
    }
  } catch (e) {
    // swallow errors to avoid breaking page
    console.warn('updateGlowElement error', e);
  }
}

/**
 * Update all glow elements in the document.
 */
function updateGlowElements() {
  try {
    document.querySelectorAll('.glow').forEach(updateGlowElement);
  } catch (e) { console.warn('updateGlowElements error', e); }
}

  const chapterObserver = new MutationObserver((mutations) => {
    let added = false;
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) { added = true; break; }
    }
    if (added) updateGlowElements();
  });
  chapterObserver.observe(chapterBodyEl, { childList: true, subtree: true });

  /* ========== Blur logic (class-based) ========== */

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
      document.querySelectorAll('.blur-target.is-blurred').forEach(el => { el.classList.remove('is-blurred'); });
    } else {
      document.querySelectorAll('.blur-target:not(.unblurred)').forEach(el => { el.classList.add('is-blurred'); });
    }
  }

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
  }

  function revealTemp(el) {
    if (!el) return;
    if (el.classList.contains('unblurred')) return;
    el.classList.add('hover-reveal');
  }
  function hideTemp(el) {
    if (!el) return;
    if (el.classList.contains('unblurred')) return;
    el.classList.remove('hover-reveal');
  }

  function initBlurTargetsForChapter(filename, blurEnabled = true) {
    if (!chapterBodyEl) return;
    chapterBodyEl.querySelectorAll('.blur-target').forEach(old => {
      old.classList.remove('is-blurred', 'hover-reveal');
      old.classList.remove('blur-target');
    });

    const targets = collectTargets();
    const readSet = loadReadIndicesFor(filename);

    targets.forEach((el, idx) => {
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
        if (isVisualBlurEnabled()) el.classList.add('is-blurred'); else el.classList.remove('is-blurred');
      }

      el.addEventListener('mouseenter', () => { if (!el.classList.contains('unblurred')) revealTemp(el); });
      el.addEventListener('mouseleave', () => { if (!el.classList.contains('unblurred')) hideTemp(el); });
      el.addEventListener('touchstart', () => { if (!el.classList.contains('unblurred')) revealTemp(el); }, {passive:true});
      el.addEventListener('touchend', () => { if (!el.classList.contains('unblurred')) hideTemp(el); }, {passive:true});
    });

    // Update glows inside the chapter (CSS will fade glow with blur)
    updateGlowElements();
  }

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
      // images & text: unblur when top crosses center (per your last request)
      if (rect.top < centerY) trigger = true;
      if (trigger) removeBlurFromTarget(el, true);
    });
  }

  window.addEventListener('scroll', () => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => { checkAndUnblurVisibleTargets(); scrollScheduled = false; });
  }, { passive: true });
  window.addEventListener('resize', () => { checkAndUnblurVisibleTargets(); });

  /* ========== Tooltip image resolve & preload ========== */
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
    for (const base of bases) { try { const u = new URL(srcCandidate, base); candidates.push(u.href); } catch (e) {} }
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
          const pimg = new Image(); pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async';
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
      const dataImg = el.getAttribute('data-img'); if (!dataImg) return;
      const resolved = resolvedUrlCache.has(dataImg) ? resolvedUrlCache.get(dataImg) : await resolveTooltipImage(dataImg);
      if (resolved && (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete)) {
        try {
          const pimg = new Image(); pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async';
          preloadedImgCache.set(resolved, pimg);
          pimg.onload = () => {};
          pimg.onerror = () => { preloadedImgCache.delete(resolved); };
          pimg.src = resolved;
        } catch (e) {}
      }
    });
  });

  /* ---------- Tippy init (gloss) ---------- */
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
          if (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete) {
            try {
              const pimg = new Image(); pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async';
              preloadedImgCache.set(resolved, pimg);
              pimg.onload = () => {};
              pimg.onerror = () => { preloadedImgCache.delete(resolved); };
              pimg.src = resolved;
            } catch (e) {}
          }
          const imgEl = document.createElement('img');
          imgEl.className = 'tooltip-img'; imgEl.src = resolved; imgEl.alt = imgAlt; imgEl.loading = 'eager'; imgEl.style.cursor='pointer';
          imgEl.addEventListener('click', (ev) => { ev.stopPropagation(); try { openImageViewer(resolved, imgAlt); } catch (e) {} try { instance.hide(); } catch (e) {} });
          imgEl.addEventListener('load', () => { try { if (instance.popperInstance && typeof instance.popperInstance.update === 'function') instance.popperInstance.update(); else if (typeof instance.update === 'function') instance.update(); } catch (e) {} });
          wrapper.appendChild(imgEl);
        }
        const contentDiv = document.createElement('div'); contentDiv.className = 'tooltip-body'; contentDiv.innerHTML = contentHTML; wrapper.appendChild(contentDiv);
        try { instance.setContent(wrapper); } catch (e) { instance.setContent(wrapper.outerHTML); }
      }
    });
  }

  /* ---------- Nav tippies ---------- */
  function refreshNavTippies() {
    if (!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if (!btn) return; try { if (btn._tippy) btn._tippy.destroy(); } catch (e) {} });
    if (bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
  }

  /* ---------- Chapters aside open/close ---------- */
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

  /* ---------- Top nav behavior ---------- */
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
  const HIDE_DELAY_MS = 1000;
  function clearHideTimer() { if (hideDelayTimer) { clearTimeout(hideDelayTimer); hideDelayTimer = null; } }
  function bottomNavIsVisible() {
    if (!bottomNav) return false;
    const r = bottomNav.getBoundingClientRect();
    return (r.top < window.innerHeight) && (r.bottom > 0);
  }
  function showTopNavImmediate() {
    if (bottomNavIsVisible()) { hideTopNavImmediate(); return; }
    if (!topNav) return;
    topNav.classList.add('visible-top'); topNav.setAttribute('aria-hidden', 'false'); clearHideTimer();
  }
  function hideTopNavImmediate() {
    if (!topNav) return;
    topNav.classList.remove('visible-top'); topNav.setAttribute('aria-hidden', 'true'); clearHideTimer();
  }
  function scheduleHideTopNav() {
    if (hideDelayTimer) return;
    hideDelayTimer = setTimeout(() => { if (!bottomNavIsVisible()) hideTopNavImmediate(); hideDelayTimer = null; }, HIDE_DELAY_MS);
  }
  function onScrollCheck() {
    const curY = window.scrollY;
    const scrollingUp = curY < lastScrollY;
    const atTop = curY <= 10;
    if (bottomNavIsVisible()) { hideTopNavImmediate(); clearHideTimer(); }
    else if (atTop || scrollingUp) { clearHideTimer(); showTopNavImmediate(); }
    else { scheduleHideTopNav(); }
    lastScrollY = curY;
  }
  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { onScrollCheck(); scheduled = false; });
  }, { passive: true });
  window.addEventListener('resize', () => { positionTopNav(); onScrollCheck(); });
  const observer = new IntersectionObserver((entries) => { const anyVisible = entries.some(en => en.isIntersecting); if (anyVisible) hideTopNavImmediate(); }, { root: null, threshold: 0.01 });
  if (bottomNav) observer.observe(bottomNav);
  function initialTopNavSetup() {
    positionTopNav();
    if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
    else hideTopNavImmediate();
  }
  initialTopNavSetup();
  setTimeout(initialTopNavSetup, 80);

  /* ---------- Image viewer (kept) ---------- */
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
    const viewer = overlay.querySelector('.viewer'); if (viewer) { viewer.scrollTop = 0; viewer.scrollLeft = 0; }
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

  // Bind images to viewer without replacing nodes (keeps blur classes intact)
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

  /* ---------- Persist scroll on reload (sessionStorage) ---------- */
  window.addEventListener('beforeunload', () => {
    try {
      if (currentIndex >= 0 && chapters[currentIndex] && chapters[currentIndex].file) {
        const key = 'scroll:' + chapters[currentIndex].file;
        sessionStorage.setItem(key, String(window.scrollY || 0));
      }
    } catch (e) {}
  });

  /* ---------- Navigation & chapters ---------- */
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
    if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); else clearHideTimer();
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

  /* ---------- Load chapters list ---------- */
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
          a.addEventListener('click', (e) => { e.preventDefault(); goToChapter(i); closeChapters(); });
        }
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

  /* ---------- Load a single chapter ---------- */
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
      try {
        const chObj = chapters[currentIndex];
        if (chObj && chObj.blur === false) blurEnabledForChapter = false;
      } catch (e) {}

      // initialize blur targets now
      initBlurTargetsForChapter(filename, blurEnabledForChapter);

      // update glow elements inside the chapter (must happen after DOM insertion)
      updateGlowElements();

      // preload tooltip images and init tippy
      preloadTooltipImages();
      initGlossTippy();

      // bind images to viewer (no node replacement)
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
              if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
            });
          });
        } else {
          if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
        }
      } catch (e) { if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); }

      // initial unblur check
      requestAnimationFrame(checkAndUnblurVisibleTargets);

    } catch (err) {
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
      console.error('loadChapter error:', err);
    }
  }

  /* ---------- Blur toggle button initialization ---------- */
  if (blurToggle) {
    const enabled = isVisualBlurEnabled();
    setVisualBlurEnabled(enabled);
    blurToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const newState = !isVisualBlurEnabled();
      setVisualBlurEnabled(newState);
    });
  }

  /* ---------- Start ---------- */
  loadChapters();
  updateNavButtons();
  setTimeout(() => { positionTopNav(); if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); }, 120);
});
