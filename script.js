// script.js - glow capture is included; blur/unblur logic unchanged
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

  /* ========== helper functions (color picker, hsv, etc) ========== */
  // ... (keep your existing helper functions here: hexToRgb, rgbToHex, rgbToHsl, hslToRgb, luminanceFromRgb, computeCardFromBgHex, applyColorHex, hsvToRgb, rgbToHsv, persistHex, applyHsvState, updatePickerUI, addDrag, handleHuePointer, handleAreaPointer, etc.)
  // For brevity in this message I haven't repeated the full color-picker code block; keep the same full color picker implementation you currently have in your script.js.
  // The only required piece for the glow fix is captureGlowInfo below, and ensuring initBlurTargetsForChapter calls it BEFORE adding blur classes.

  // Parse an rgb/rgba string into r,g,b numbers. Returns object {r,g,b} or null.
  function parseRgbString(rgbStr) {
    if (!rgbStr) return null;
    const m = rgbStr.match(/rgba?\(\s*([0-9]+)[,\s]+([0-9]+)[,\s]+([0-9]+)/i);
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }

  // Capture original color + glow attributes for all .glow elements
  function captureGlowInfo() {
    if (!chapterBodyEl) return;
    const glowEls = Array.from(chapterBodyEl.querySelectorAll('.glow'));
    glowEls.forEach(el => {
      try {
        const cs = window.getComputedStyle(el);
        const colStr = cs.color;
        const rgb = parseRgbString(colStr);
        if (rgb) {
          el.style.setProperty('--glow-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
        } else {
          // fallback to white
          el.style.setProperty('--glow-rgb', `255, 255, 255`);
        }
        // density & brightness from attributes (defaults 1)
        const dens = parseFloat(el.getAttribute('glow-density'));
        const bright = parseFloat(el.getAttribute('glow-brightness'));
        if (!Number.isNaN(dens) && dens > 0) el.style.setProperty('--glow-density', String(dens));
        else el.style.setProperty('--glow-density', '1');
        if (!Number.isNaN(bright) && bright > 0) el.style.setProperty('--glow-brightness', String(bright));
        else el.style.setProperty('--glow-brightness', '1');
      } catch (e) {
        // ignore
      }
    });
  }

  /* ========== blur init uses captureGlowInfo BEFORE applying blur classes ========== */

  function initBlurTargetsForChapter(filename, blurEnabled = true) {
    if (!chapterBodyEl) return;

    // FIRST: capture glow info while original colors are still present
    captureGlowInfo();

    // cleanup existing (preserve 'unblurred' if it exists)
    chapterBodyEl.querySelectorAll('.blur-target').forEach(old => {
      old.classList.remove('is-blurred', 'hover-reveal');
      old.classList.remove('blur-target'); // will re-add
    });

    // Collect targets (images as separate targets, text blocks otherwise)
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

    const readSet = (function loadReadIndicesFor(filename) {
      try {
        const raw = localStorage.getItem('read:' + filename);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr);
      } catch (e) { return new Set(); }
    })(filename);

    targets.forEach((el, idx) => {
      el.dataset.blurIndex = idx;
      el.classList.add('blur-target');

      // if blur disabled for this chapter, mark unblurred
      if (!blurEnabled) {
        el.classList.add('unblurred');
        el.classList.remove('is-blurred');
        return;
      }

      // initial state
      if (el.classList.contains('unblurred') || readSet.has(idx)) {
        el.classList.add('unblurred');
        el.classList.remove('is-blurred');
      } else {
        if ((function isVisualBlurEnabled() {
          try {
            const v = localStorage.getItem('blur-visual-enabled');
            if (v === null) return true;
            return v === 'true';
          } catch (e) { return true; }
        })()) {
          el.classList.add('is-blurred');
        } else {
          el.classList.remove('is-blurred');
        }
      }

      // attach hover handlers
      el.addEventListener('mouseenter', () => { if (!el.classList.contains('unblurred')) el.classList.add('hover-reveal'); });
      el.addEventListener('mouseleave', () => { if (!el.classList.contains('unblurred')) el.classList.remove('hover-reveal'); });
      el.addEventListener('touchstart', () => { if (!el.classList.contains('unblurred')) el.classList.add('hover-reveal'); }, {passive:true});
      el.addEventListener('touchend', () => { if (!el.classList.contains('unblurred')) el.classList.remove('hover-reveal'); }, {passive:true});
    });
  }

  /* === rest of your script remains unchanged ===
     (tooltip init, preload images, image viewer, nav, color picker, scroll/unblur rules, etc.)
     Please keep the rest of your working script code exactly as you had it.
     The important changes for the glow fix are:
       - captureGlowInfo() runs BEFORE blur classes are applied
       - CSS updated (see styles.css) to cover glow-on-same-element and allow transitions
  */

  // At the end: call your startup loader (e.g. loadChapters()) as before.
  // If you replaced earlier full script, keep the existing full flow; the captureGlowInfo() function above is the addition you need.
});
