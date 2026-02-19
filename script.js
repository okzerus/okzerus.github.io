/* script.js - full-featured replacement
   Features:
   - chapters.json loading (supports "done": false and "blur": false)
   - slide-out chapters list (open near left-edge hover)
   - top and bottom nav buttons, tooltips via tippy
   - top nav behavior: visible at top or when scrolling up, 1s delayed fade on scroll down
   - edge scroll button that centers next blurred target (flush to content edge)
   - blur system with per-chapter enable/disable, hover reveal, persisted "read" indices and session scroll restore on refresh
   - color picker (small panel) with live update and reset
   - tooltip images + preloading; tooltip images clickable to open viewer
   - image viewer: single-click toggles zoom; dragging while zoomed moves image; releasing after drag does not toggle zoom
   - glow and glitch support tied into blur (hidden while blurred)
   - persists last open chapter (localStorage) and remembers read items per chapter
*/

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // DOM refs
    const chaptersListEl = document.getElementById('chapters');
    const chapterBodyEl = document.getElementById('chapter-body');
    const chapterTitleEl = document.getElementById('chapter-title');
    const blurToggle = document.getElementById('blur-toggle');
    const themeToggle = document.getElementById('theme-toggle');
    const colorPopup = document.getElementById('color-popup');
    const colorArea = document.getElementById('color-area');
    const colorAreaCursor = document.getElementById('color-area-cursor');
    const hueSlider = document.getElementById('hue-slider');
    const hueCursor = document.getElementById('hue-cursor');
    const colorResetBtn = document.getElementById('color-reset');

    const bottomPrev = document.getElementById('bottom-prev');
    const bottomNext = document.getElementById('bottom-next');
    const bottomNav = document.getElementById('bottom-nav');

    const topPrev = document.getElementById('top-prev');
    const topNext = document.getElementById('top-next');
    const topNav = document.getElementById('top-nav');

    const chaptersAside = document.getElementById('chapters-list');

    if (!chaptersListEl || !chapterBodyEl || !chapterTitleEl) {
      console.error('Essential DOM elements missing. Check index.html IDs.');
      return;
    }

    // state
    let chapters = [];
    let currentIndex = -1;
    let lastChapterFile = null;
    const resolvedUrlCache = new Map();
    const preloadedImgCache = new Map();

    // edge button / positioning
    let edgeBtn = null;
    let lastEdgePos = null;
    let edgePosScheduled = false;

    // blur config
    const BLUR_THRESHOLD_Y_RATIO = 0.5;
    const BLUR_VISUAL_KEY = 'blur-visual-enabled';
    const STORAGE_KEY_BG = 'site-bg-color';
    const STORAGE_LAST_CHAPTER = 'last-chapter-file';

    /* -------------------- small helpers -------------------- */
    function hexToRgb(hex) {
      hex = (hex || '').replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      const n = parseInt(hex, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    function rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    }
    function luminanceFromRgb(r, g, b) {
      const srgb = [r, g, b].map(v => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    }

    /* -------------------- Color picker (simple HSV-based) -------------------- */
    let hsv = { h: 210, s: 0.3, v: 0.05 }; // starting guess
    (function initColor() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY_BG);
        const hex = stored || getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b0f13';
        applyColorHex(hex);
      } catch (e) { applyColorHex('#0b0f13'); }
      // UI update will be done on first open
    })();

    function applyColorHex(hex) {
      try {
        const { r, g, b } = hexToRgb(hex);
        document.documentElement.style.setProperty('--bg', hex);
        // card slightly lighter: we'll just set --card using a slightly lighter HSL approach: naive lighten by 8%
        // simple approximation: add 20 to each channel but clamp (keeps same appearance across light/dark transitions)
        const r2 = Math.min(255, Math.round(r + 20));
        const g2 = Math.min(255, Math.round(g + 20));
        const b2 = Math.min(255, Math.round(b + 20));
        document.documentElement.style.setProperty('--card', rgbToHex(r2, g2, b2));
        // pick accent based on luminance
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
        localStorage.setItem(STORAGE_KEY_BG, hex);
      } catch (e) {}
    }

    // small drag helpers for the custom picker
    function addDrag(element, handlers) {
      if (!element) return;
      let dragging = false, pointerId = null;
      element.addEventListener('pointerdown', ev => {
        element.setPointerCapture && element.setPointerCapture(ev.pointerId);
        dragging = true; pointerId = ev.pointerId;
        handlers.start && handlers.start(ev);
        ev.preventDefault();
      });
      window.addEventListener('pointermove', ev => {
        if (!dragging || (pointerId !== null && ev.pointerId !== pointerId)) return;
        handlers.move && handlers.move(ev);
        ev.preventDefault();
      }, { passive: false });
      window.addEventListener('pointerup', ev => {
        if (!dragging || (pointerId !== null && ev.pointerId !== pointerId)) return;
        dragging = false; pointerId = null;
        handlers.end && handlers.end(ev);
        ev.preventDefault();
      });
    }

    if (hueSlider) addDrag(hueSlider, {
      start: handleHuePointer, move: handleHuePointer, end: () => { persistColor(); }
    });
    if (colorArea) addDrag(colorArea, {
      start: handleAreaPointer, move: handleAreaPointer, end: () => { persistColor(); }
    });

    function handleHuePointer(e) {
      const rect = hueSlider.getBoundingClientRect();
      const y = Math.min(Math.max(0, (e.clientY || 0) - rect.top), rect.height);
      const ratio = 1 - (y / rect.height);
      hsv.h = Math.round(ratio * 360);
      updatePickerUI();
      applyFromHsv();
    }
    function handleAreaPointer(e) {
      const rect = colorArea.getBoundingClientRect();
      const x = Math.min(Math.max(0, (e.clientX || 0) - rect.left), rect.width);
      const y = Math.min(Math.max(0, (e.clientY || 0) - rect.top), rect.height);
      hsv.s = x / rect.width; hsv.v = 1 - (y / rect.height);
      updatePickerUI();
      applyFromHsv();
    }
    function updatePickerUI() {
      if (!colorArea || !hueSlider || !colorAreaCursor || !hueCursor) return;
      const { r, g, b } = hsvToRgb(hsv.h, 1, 1);
      colorArea.style.background = `linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0)), linear-gradient(to right, rgba(255,255,255,1), rgba(255,255,255,0)), rgb(${r},${g},${b})`;
      const sliderRect = hueSlider.getBoundingClientRect();
      const y = sliderRect.height * (1 - (hsv.h / 360));
      hueCursor.style.top = `${Math.min(Math.max(0, y), sliderRect.height)}px`;
      const areaRect = colorArea.getBoundingClientRect();
      const cx = areaRect.width * hsv.s;
      const cy = areaRect.height * (1 - hsv.v);
      colorAreaCursor.style.left = `${Math.min(Math.max(0, cx), areaRect.width)}px`;
      colorAreaCursor.style.top = `${Math.min(Math.max(0, cy), areaRect.height)}px`;
    }
    function hsvToRgb(h, s, v) {
      h = ((h % 360) + 360) % 360;
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
    function applyFromHsv() {
      const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
      applyColorHex(rgbToHex(r, g, b));
    }
    function persistColor() {
      const computed = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b0f13';
      try { localStorage.setItem(STORAGE_KEY_BG, computed); } catch (e) {}
    }

    // open/close color popup
    function showColorPopup() { if (!colorPopup) return; colorPopup.classList.add('visible'); colorPopup.setAttribute('aria-hidden', 'false'); document.addEventListener('click', onDocClickForPopup); updatePickerUI(); }
    function hideColorPopup() { if (!colorPopup) return; colorPopup.classList.remove('visible'); colorPopup.setAttribute('aria-hidden', 'true'); document.removeEventListener('click', onDocClickForPopup); }
    function onDocClickForPopup(e) { if (!colorPopup) return; if (colorPopup.contains(e.target) || (themeToggle && themeToggle.contains(e.target))) return; hideColorPopup(); }
    if (themeToggle) themeToggle.addEventListener('click', (e) => { e.stopPropagation(); if (!colorPopup) return; if (colorPopup.classList.contains('visible')) hideColorPopup(); else { // init HSV from current bg
      const bgHex = (getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#0b0f13').trim(); const c = hexToRgb(bgHex); const hv = rgbToHsv(c.r, c.g, c.b); hsv.h = hv.h || 0; hsv.s = hv.s || 0; hsv.v = hv.v || 0; updatePickerUI(); showColorPopup(); } });
    if (colorResetBtn) colorResetBtn.addEventListener('click', (e) => { e.stopPropagation(); applyColorHex('#0b0f13'); hideColorPopup(); });

    // rgb -> hsv
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

    /* -------------------- Chapters loading & navigation -------------------- */
    function isDoneEntry(entry) { return !(entry && entry.done === false); }

    async function loadChapters() {
      chapterBodyEl.textContent = 'Загрузка...';
      try {
        const res = await fetch('chapters.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('chapters.json must be an array');
        chapters = data;
        chaptersListEl.innerHTML = '';
        chapters.forEach((c, i) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = '#';
          a.textContent = c.title || `Глава ${i+1}`;
          if (!isDoneEntry(c)) a.classList.add('undone');
          else a.addEventListener('click', (e) => { e.preventDefault(); goToChapter(i); closeChapters(); });
          li.appendChild(a);
          chaptersListEl.appendChild(li);
        });

        // resume last-chapter if possible
        try {
          const saved = localStorage.getItem(STORAGE_LAST_CHAPTER);
          if (saved) {
            const idx = chapters.findIndex(ch => ch && ch.file === saved && isDoneEntry(ch));
            if (idx !== -1) { goToChapter(idx); return; }
          }
        } catch (e) {}

        const first = chapters.findIndex(ch => isDoneEntry(ch));
        if (first !== -1) goToChapter(first);
        else { chapterBodyEl.textContent = 'Нет доступных (done) глав.'; }
      } catch (err) {
        chapterBodyEl.textContent = 'Ошибка: ' + err.message;
        console.error(err);
      }
    }

    function updateNavButtons() {
      const prevIndex = findPrevDoneIndex();
      const nextIndex = findNextDoneIndex();
      const prevDisabled = prevIndex === -1;
      const nextDisabled = nextIndex === -1;
      [bottomPrev, topPrev].forEach(b => { if (b) b.disabled = prevDisabled; });
      [bottomNext, topNext].forEach(b => { if (b) b.disabled = nextDisabled; });

      if (!prevDisabled) {
        const p = chapters[prevIndex];
        [bottomPrev, topPrev].forEach(b => { if (b) { b.dataset.index = prevIndex; b.dataset.title = p.title || ''; }});
      } else { [bottomPrev, topPrev].forEach(b => { if (b) { b.removeAttribute('data-index'); b.removeAttribute('data-title'); }}); }

      if (!nextDisabled) {
        const n = chapters[nextIndex];
        [bottomNext, topNext].forEach(b => { if (b) { b.dataset.index = nextIndex; b.dataset.title = n.title || ''; }});
      } else { [bottomNext, topNext].forEach(b => { if (b) { b.removeAttribute('data-index'); b.removeAttribute('data-title'); }}); }

      refreshNavTippies();
    }

    function findPrevDoneIndex(fromIndex) {
      for (let i = (fromIndex === undefined ? currentIndex - 1 : fromIndex); i >= 0; i--) if (isDoneEntry(chapters[i])) return i;
      return -1;
    }
    function findNextDoneIndex(fromIndex) {
      for (let i = (fromIndex === undefined ? currentIndex + 1 : fromIndex); i < chapters.length; i++) if (isDoneEntry(chapters[i])) return i;
      return -1;
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
      try { localStorage.setItem(STORAGE_LAST_CHAPTER, c.file); } catch (e) {}
    }

    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.index);
        if (!Number.isNaN(idx)) goToChapter(idx);
      });
    });

    document.addEventListener('keydown', (e) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key === 'ArrowLeft') { const p = findPrevDoneIndex(); if (p !== -1) goToChapter(p); }
      if (e.key === 'ArrowRight') { const n = findNextDoneIndex(); if (n !== -1) goToChapter(n); }
    });

    /* ---------- load single chapter ---------- */
    async function loadChapter(filename, title) {
      chapterTitleEl.textContent = title || '';
      chapterBodyEl.textContent = 'Загрузка главы...';
      try {
        const res = await fetch('chapters/' + filename, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const md = await res.text();
        lastChapterFile = filename;
        const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: marked не загружен</p>';
        chapterBodyEl.innerHTML = html;

        // detect per-chapter blur flag
        let blurEnabled = true;
        try { const ch = chapters[currentIndex]; if (ch && ch.blur === false) blurEnabled = false; } catch (e) {}

        // init glow, blur targets, glitch, tippy, images, etc.
        captureGlowInfo();
        initBlurTargetsForChapter(filename, blurEnabled);
        preloadTooltipImages();
        initGlossTippy();
        initGlitchForChapter();
        bindImagesToViewer();

        updateNavButtons();

        // restore session scroll value (only on refresh)
        try {
          const key = 'scroll:' + filename;
          const v = sessionStorage.getItem(key);
          if (v !== null) {
            const scrollVal = Number(v) || 0;
            requestAnimationFrame(() => requestAnimationFrame(() => { window.scrollTo({ top: scrollVal, behavior: 'auto' }); try { sessionStorage.removeItem(key); } catch (e) {} }));
          } else {
            // if at top, ensure top-nav visible
            if (window.scrollY <= 10) showTopNavImmediate();
          }
        } catch (e) {}

        // initial unblur check
        requestAnimationFrame(checkAndUnblurVisibleTargets);

        // update edge scroll button
        updateEdgeScrollVisibility();
        updateEdgeScrollPosition();
        // ensure top nav correctness after loading
        initialTopNavSetup();
      } catch (err) {
        chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
        console.error(err);
      }
    }

    /* -------------------- Blur handling -------------------- */
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
    if (blurToggle) {
      blurToggle.addEventListener('click', (e) => { e.stopPropagation(); setVisualBlurEnabled(!isVisualBlurEnabled()); });
      setVisualBlurEnabled(isVisualBlurEnabled());
    }

    function collectTargets() {
      const targets = [];
      const children = Array.from(chapterBodyEl.children);
      children.forEach(child => {
        const imgs = Array.from(child.querySelectorAll('img'));
        if (imgs.length > 0 && child.tagName.toLowerCase() !== 'img') imgs.forEach(img => targets.push(img));
        else targets.push(child);
      });
      return targets;
    }

    function revealTemp(el) { if (!el) return; if (el.classList.contains('unblurred')) return; el.classList.add('hover-reveal'); }
    function hideTemp(el) { if (!el) return; if (el.classList.contains('unblurred')) return; el.classList.remove('hover-reveal'); }

    // INIT blur-targets for the current chapter
    function initBlurTargetsForChapter(filename, blurEnabled = true) {
      if (!chapterBodyEl) return;
      // clear any previous .blur-target classes/handlers
      chapterBodyEl.querySelectorAll('.blur-target').forEach(old => {
        old.classList.remove('is-blurred', 'hover-reveal', 'unblurred', 'blur-target');
      });

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
            el.classList.add('unblurred'); el.classList.remove('is-blurred');
          } else {
            if (isVisualBlurEnabled()) el.classList.add('is-blurred'); else el.classList.remove('is-blurred');
          }

          // hover/touch reveal
          el.addEventListener('mouseenter', () => { if (!el.classList.contains('unblurred')) revealTemp(el); });
          el.addEventListener('mouseleave', () => { if (!el.classList.contains('unblurred')) hideTemp(el); });
          el.addEventListener('touchstart', () => { if (!el.classList.contains('unblurred')) revealTemp(el); }, { passive: true });
          el.addEventListener('touchend', () => { if (!el.classList.contains('unblurred')) hideTemp(el); }, { passive: true });
        } catch (e) {}
      });

      updateEdgeScrollVisibility();
    }

    function removeBlurFromTarget(el, markRead = true) {
      if (!el) return;
      if (el.classList.contains('unblurred')) return;
      el.classList.remove('is-blurred'); el.classList.add('unblurred');
      if (markRead && lastChapterFile) {
        const set = loadReadIndicesFor(lastChapterFile);
        const index = Number(el.dataset.blurIndex);
        if (!Number.isNaN(index)) { set.add(index); saveReadIndicesFor(lastChapterFile, set); }
      }
      updateEdgeScrollVisibility();
    }

    /* ---------- Check scroll to auto-unblur ---------- */
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
        // text: when top reaches center; images preserved behavior optionally: use top
        if (el.tagName && el.tagName.toLowerCase() === 'img') { if (rect.top < centerY) trigger = true; }
        else { if (rect.top < centerY) trigger = true; }
        if (trigger) removeBlurFromTarget(el, true);
      });
      updateEdgeScrollVisibility();
      updateGlitchIntensityAll();
    }
    window.addEventListener('scroll', () => {
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(() => { checkAndUnblurVisibleTargets(); scrollScheduled = false; });
    }, { passive: true });
    window.addEventListener('resize', () => { checkAndUnblurVisibleTargets(); scheduleEdgePosUpdate(); });

    /* ----------------- tooltip image resolver & preload ----------------- */
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
        const p = lastChapterFile.split('/'); p.pop(); const parent = p.join('/');
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
        const dataImg = el.getAttribute('data-img'); if (!dataImg) continue;
        if (resolvedUrlCache.has(dataImg) && resolvedUrlCache.get(dataImg) === null) continue;
        try {
          const resolved = await resolveTooltipImage(dataImg);
          if (resolved && !preloadedImgCache.has(resolved)) {
            const pimg = new Image(); pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async';
            preloadedImgCache.set(resolved, pimg); pimg.src = resolved;
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
          try { const pimg = new Image(); pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async'; preloadedImgCache.set(resolved, pimg); pimg.src = resolved; } catch (e) {}
        }
      });
    });

    /* -------------------- tippy init -------------------- */
    function initGlossTippy() {
      if (!window.tippy) return;
      document.querySelectorAll('.gloss').forEach(el => { try { if (el._tippy) el._tippy.destroy(); } catch (e) {} });
      tippy('.gloss', {
        allowHTML: true, interactive: true, delay: [60, 80], maxWidth: 520, placement: 'top', offset: [0, 8],
        appendTo: () => document.body,
        popperOptions: { strategy: 'fixed', modifiers: [{ name: 'computeStyles', options: { adaptive: false } }, { name: 'preventOverflow', options: { padding: 8, altAxis: true } }, { name: 'flip', options: { fallbackPlacements: ['bottom', 'right', 'left'] } }] },
        content: 'Loading...',
        onShow: async (instance) => {
          const ref = instance.reference;
          let contentHTML = ref.getAttribute('data-tippy-content') || ref.getAttribute('data-tip') || ref.getAttribute('title') || ref.innerHTML || '';
          if (ref.getAttribute('title')) ref.removeAttribute('title');
          const dataImg = ref.getAttribute('data-img');
          const imgAlt = ref.getAttribute('data-img-alt') || '';
          const wrapper = document.createElement('div');
          let resolved = null;
          if (dataImg) {
            if (resolvedUrlCache.has(dataImg)) resolved = resolvedUrlCache.get(dataImg);
            else resolved = await resolveTooltipImage(dataImg);
          }
          if (resolved) {
            if (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete) {
              const pimg = new Image(); pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async'; preloadedImgCache.set(resolved, pimg); pimg.src = resolved;
            }
            const imgEl = document.createElement('img'); imgEl.className = 'tooltip-img'; imgEl.src = resolved; imgEl.alt = imgAlt; imgEl.loading = 'eager'; imgEl.style.cursor = 'pointer';
            imgEl.addEventListener('click', (ev) => { ev.stopPropagation(); openImageViewer(resolved, imgAlt); try { instance.hide(); } catch (e) {} });
            imgEl.addEventListener('load', () => { try { if (instance.popperInstance && typeof instance.popperInstance.update === 'function') instance.popperInstance.update(); else if (typeof instance.update === 'function') instance.update(); } catch (e) {} });
            wrapper.appendChild(imgEl);
          }
          const contentDiv = document.createElement('div'); contentDiv.className = 'tooltip-body'; contentDiv.innerHTML = contentHTML; wrapper.appendChild(contentDiv);
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

    /* -------------------- image viewer (click zoom + drag) -------------------- */
    const overlay = document.getElementById('image-overlay');
    const overlayImg = overlay.querySelector('.viewer-img');
    let isZoomed = false, pointerDown = false, pointerStart = { x: 0, y: 0 }, imgPos = { x: 0, y: 0 }, dragMoved = false, suppressClick = false;
    const DRAG_THRESHOLD = 6;

    function openImageViewer(src, alt = '') {
      overlayImg.src = src; overlayImg.alt = alt || '';
      const marginPx = 40;
      overlayImg.style.maxWidth = `calc(100vw - ${marginPx}px)`; overlayImg.style.maxHeight = `calc(100vh - ${Math.round(marginPx * 1.5)}px)`;
      overlay.classList.add('visible'); overlay.setAttribute('aria-hidden', 'false');
      isZoomed = false; imgPos = { x: 0, y: 0 }; overlayImg.style.transform = `translate(0px, 0px) scale(1)`; overlayImg.classList.remove('zoomed'); document.body.style.overflow = 'hidden';
    }
    function closeImageViewer() { overlay.classList.remove('visible'); overlay.setAttribute('aria-hidden', 'true'); overlayImg.src = ''; isZoomed = false; pointerDown = false; dragMoved = false; suppressClick = false; document.body.style.overflow = ''; overlayImg.style.maxWidth = ''; overlayImg.style.maxHeight = ''; }
    function applyImageTransform() {
      const scale = isZoomed ? 2 : 1;
      overlayImg.style.transform = `translate(${imgPos.x}px, ${imgPos.y}px) scale(${scale})`;
      if (isZoomed) overlayImg.classList.add('zoomed'); else overlayImg.classList.remove('zoomed');
    }

    // pointer handling (prevents click on release after drag from toggling zoom)
    overlayImg.addEventListener('pointerdown', (ev) => {
      if (!overlay.classList.contains('visible')) return;
      overlayImg.setPointerCapture && overlayImg.setPointerCapture(ev.pointerId);
      pointerDown = true; dragMoved = false; pointerStart = { x: ev.clientX, y: ev.clientY };
    });
    overlayImg.addEventListener('pointermove', (ev) => {
      if (!pointerDown || !isZoomed) return;
      const dx = ev.clientX - pointerStart.x, dy = ev.clientY - pointerStart.y;
      if (!dragMoved && (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD)) dragMoved = true;
      if (dragMoved) { pointerStart = { x: ev.clientX, y: ev.clientY }; imgPos.x += dx; imgPos.y += dy; applyImageTransform(); }
    });
    overlayImg.addEventListener('pointerup', (ev) => {
      if (!pointerDown) return;
      // if it wasn't dragged, treat as click and toggle zoom
      if (!dragMoved) {
        isZoomed = !isZoomed;
        if (!isZoomed) imgPos = { x: 0, y: 0 };
        applyImageTransform();
      } else {
        // dragged — do not toggle; small suppression of click
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
      }
      pointerDown = false;
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

    /* -------------------- Edge scroll button (flush to content edge) -------------------- */
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
        // trigger smooth fade by removing 'is-blurred'
        next.classList.remove('is-blurred');
        // scroll to center
        scrollToTargetElement(next);
        updateEdgeScrollVisibility();
        updateGlitchForElement(next);
      });
    }

    function updateEdgeScrollPosition() {
      if (!edgeBtn) return;
      const content = document.getElementById('content');
      if (!content) return;
      const rect = content.getBoundingClientRect();
      if (rect.width < 120 || rect.right <= 0) { edgeBtn.style.opacity = '0'; edgeBtn.style.pointerEvents = 'none'; return; }
      const btnW = edgeBtn.offsetWidth || 34;
      const leftPx = Math.round(rect.right + window.scrollX - (btnW / 2));
      if (lastEdgePos === leftPx) return;
      edgeBtn.style.left = `${leftPx}px`;
      lastEdgePos = leftPx;
    }

    function scheduleEdgePosUpdate() {
      if (edgePosScheduled) return;
      edgePosScheduled = true;
      requestAnimationFrame(() => { updateEdgeScrollPosition(); edgePosScheduled = false; });
    }
    window.addEventListener('scroll', scheduleEdgePosUpdate, { passive: true });
    window.addEventListener('resize', scheduleEdgePosUpdate);

    function isMeaningfulElement(el) {
      if (!el) return false;
      if (el.tagName && el.tagName.toLowerCase() === 'img') return true;
      if (el.querySelector && el.querySelector('img')) return true;
      if (el.textContent && el.textContent.trim().length > 0) return true;
      const r = el.getBoundingClientRect();
      if (r.height >= 18) return true;
      return false;
    }

    function findNextBlurTargetElement() {
      if (!chapterBodyEl) return null;
      const nodes = Array.from(chapterBodyEl.querySelectorAll('.blur-target:not(.unblurred)'));
      if (!nodes.length) return null;
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

    /* -------------------- Glow capture -------------------- */
    function parseRgbString(rgbStr) {
      if (!rgbStr) return null;
      const m = rgbStr.match(/rgba?\(\s*([0-9]+)[,\s]+([0-9]+)[,\s]+([0-9]+)/i);
      if (!m) return null;
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
    }
    function captureGlowInfo() {
      if (!chapterBodyEl) return;
      const glowEls = Array.from(chapterBodyEl.querySelectorAll('.glow'));
      glowEls.forEach(el => {
        try {
          const cs = window.getComputedStyle(el);
          const colStr = cs.color;
          const rgb = parseRgbString(colStr);
          if (rgb) el.style.setProperty('--glow-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
          else el.style.setProperty('--glow-rgb', `255, 255, 255`);
          const dens = parseFloat(el.getAttribute('glow-density'));
          const bright = parseFloat(el.getAttribute('glow-brightness'));
          if (!Number.isNaN(dens) && dens > 0) el.style.setProperty('--glow-density', String(dens));
          else el.style.setProperty('--glow-density', '1');
          if (!Number.isNaN(bright) && bright > 0) el.style.setProperty('--glow-brightness', String(bright));
          else el.style.setProperty('--glow-brightness', '1');
          const txt = el.textContent || '';
          el.setAttribute('data-glow', txt.replace(/^\n+|\n+$/g, ''));
          el.style.textShadow = 'none';
        } catch (e) {}
      });
    }

    /* -------------------- Glitch support -------------------- */
    const GLITCH_MAX_OFFSET = 26, GLITCH_MIN_DURATION = 700, GLITCH_MAX_DURATION = 1400;
    function initGlitchForChapter() {
      if (!chapterBodyEl) return;
      const gls = Array.from(chapterBodyEl.querySelectorAll('.glitch'));
      gls.forEach(el => {
        const txt = el.textContent || '';
        el.setAttribute('data-glitch-content', txt.replace(/^\n+|\n+$/g, ''));
        el.style.setProperty('--g1-x', '2px'); el.style.setProperty('--g1-y', '0px'); el.style.setProperty('--g2-x', '13px'); el.style.setProperty('--g2-skew', '-13deg');
        el.style.setProperty('--gb-x', '-22px'); el.style.setProperty('--gb-y', '5px'); el.style.setProperty('--gb-skew', '21deg');
        el.style.setProperty('--g-opacity', '0.85'); el.style.setProperty('--g-duration', `${GLITCH_MIN_DURATION}ms`);
        el.dataset._glitchInited = '1';
      });
      updateGlitchIntensityAll();
    }

    function computeDistanceFactor(el) {
      const rect = el.getBoundingClientRect();
      const elCenter = rect.top + rect.height / 2;
      const viewportCenter = window.innerHeight / 2;
      const dist = Math.abs(elCenter - viewportCenter);
      const denom = (window.innerHeight / 2) || 1;
      let f = dist / denom; if (f < 0) f = 0; if (f > 1) f = 1; return f;
    }

    function updateGlitchForElement(el) {
      if (!el || !el.dataset._glitchInited) return;
      const fixed = el.getAttribute('data-glitch-fixed');
      const fixedIntensityAttr = parseFloat(el.getAttribute('data-glitch-intensity'));
      let intensity;
      if (fixed === 'true') intensity = Number.isFinite(fixedIntensityAttr) ? Math.min(Math.max(fixedIntensityAttr, 0), 1) : 0.6;
      else if (!Number.isFinite(fixedIntensityAttr) || Number.isNaN(fixedIntensityAttr)) intensity = computeDistanceFactor(el);
      else intensity = Math.max(computeDistanceFactor(el), Math.min(Math.max(fixedIntensityAttr, 0), 1));

      const mainOffset = Math.round(2 + intensity * GLITCH_MAX_OFFSET);
      const topOffset = Math.round(mainOffset * 0.75);
      const bottomOffset = Math.round(mainOffset * 1.0);
      const topSkew = -6 - intensity * 15;
      const bottomSkew = 6 + intensity * 20;
      const duration = Math.round(GLITCH_MIN_DURATION + intensity * (GLITCH_MAX_DURATION - GLITCH_MIN_DURATION));

      el.style.setProperty('--g1-x', `${Math.max(1, topOffset)}px`);
      el.style.setProperty('--g1-y', `${Math.round(-1 * (intensity * 2))}px`);
      el.style.setProperty('--g2-x', `${Math.max(2, Math.round(topOffset * 1.6))}px`);
      el.style.setProperty('--g2-skew', `${topSkew}deg`);
      el.style.setProperty('--gb-x', `${Math.round(-1 * bottomOffset)}px`);
      el.style.setProperty('--gb-y', `${Math.round(bottomOffset * 0.25)}px`);
      el.style.setProperty('--gb-skew', `${bottomSkew}deg`);
      el.style.setProperty('--g-opacity', `${0.9 - intensity * 0.35}`);
      el.style.setProperty('--g-duration', `${duration}ms`);
      el.style.setProperty('--g-main-x', `${Math.round(intensity * 2)}px`);
    }

    let glitchScheduled = false;
    function updateGlitchIntensityAll() {
      if (glitchScheduled) return;
      glitchScheduled = true;
      requestAnimationFrame(() => {
        const els = Array.from(chapterBodyEl.querySelectorAll('.glitch'));
        els.forEach(el => updateGlitchForElement(el));
        glitchScheduled = false;
      });
    }
    window.addEventListener('scroll', updateGlitchIntensityAll, { passive: true });
    window.addEventListener('resize', updateGlitchIntensityAll);

    /* -------------------- Top nav behavior (1s delay fade-out when scrolling down) -------------------- */
    function positionTopNav() {
      if (!topNav) return;
      const headerEl = document.querySelector('header');
      if (!headerEl) return;
      const hRect = headerEl.getBoundingClientRect();
      const topNavRect = topNav.getBoundingClientRect();
      const top = Math.max(6, hRect.top + (hRect.height / 2) - (topNavRect.height / 2));
      topNav.style.top = `${top}px`;
    }
    let lastScrollY = window.scrollY;
    let scheduledNav = false;
    let hideDelayTimer = null;
    const HIDE_DELAY_MS = 1000;
    function clearHideTimer() { if (hideDelayTimer) { clearTimeout(hideDelayTimer); hideDelayTimer = null; } }
    function bottomNavIsVisible() {
      if (!bottomNav) return false;
      const r = bottomNav.getBoundingClientRect();
      return (r.top < window.innerHeight) && (r.bottom > 0);
    }
    function showTopNavImmediate() {
      if (!topNav) return;
      if (bottomNavIsVisible()) { hideTopNavImmediate(); return; }
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
      if (scheduledNav) return;
      scheduledNav = true;
      requestAnimationFrame(() => { onScrollCheck(); scheduledNav = false; });
    }, { passive: true });
    window.addEventListener('resize', () => { positionTopNav(); onScrollCheck(); });

    function initialTopNavSetup() { positionTopNav(); if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); else hideTopNavImmediate(); }
    initialTopNavSetup();

    /* -------------------- Chapters aside open/close -------------------- */
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

    /* -------------------- Persist scroll on page refresh only -------------------- */
    window.addEventListener('beforeunload', () => {
      try {
        if (currentIndex >= 0 && chapters[currentIndex] && chapters[currentIndex].file) {
          const key = 'scroll:' + chapters[currentIndex].file;
          sessionStorage.setItem(key, String(window.scrollY || 0));
        }
      } catch (e) {}
    });

    /* -------------------- Utility: tooltip & nav initialization -------------------- */
    function refreshAllTippies() { initGlossTippy(); refreshNavTippies(); }

    /* -------------------- Start-up -------------------- */
    createEdgeScrollButton();
    loadChapters();

    // expose some functions to global for debugging (optional)
    window._site = {
      openImageViewer, closeImageViewer, applyColorHex, updateGlitchIntensityAll
    };
  });
})();
