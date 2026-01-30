// script.js - updated behavior per user's request
// - top arrows: visible at page load when at top, hide after 1s when scrolling down,
//   never show if bottom arrows are visible, show immediately after in-app navigation if at top
// - scroll persistence: saved to sessionStorage on beforeunload and restored on reload only
// - preserves all prior features: tippy tooltips (preload), image viewer, done-flag, chapters slideout, theme

document.addEventListener('DOMContentLoaded', () => {
  // DOM refs
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

  /* THEME */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('site-theme', theme);
    setThemeIcon(theme);
  }
  function setThemeIcon(theme) {
    if (!themeToggle) return;
    themeToggle.textContent = (theme === 'dark') ? '☀︎' : '☾';
    themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }
  (function initTheme() {
    const saved = localStorage.getItem('site-theme');
    applyTheme(saved === 'light' ? 'light' : 'dark');
  })();
  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

  /* DONE/Navigation helpers */
  function isDoneEntry(entry) {
    if (!entry) return false;
    return entry.done !== false;
  }
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
    // ensure top nav presence if at top
    window.scrollTo({ top: 0, behavior: 'auto' });
    // Immediately show top nav when going to a new chapter and at top
    if (window.scrollY <= 10 && !bottomNavIsVisible()) {
      showTopNavImmediate();
    } else {
      // if not at top, we may schedule hide as usual
      // cancel any pending hide so user sees top nav briefly if it was visible
      clearHideTimer();
    }
    closeChapters();

    // persist last-open chapter filename for reload restore
    try { localStorage.setItem('last-chapter-file', c.file); } catch (e) {}
  }

  if (bottomPrev) bottomPrev.addEventListener('click', () => { const i = Number(bottomPrev.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (bottomNext) bottomNext.addEventListener('click', () => { const i = Number(bottomNext.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (topPrev) topPrev.addEventListener('click', () => { const i = Number(topPrev.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (topNext) topNext.addEventListener('click', () => { const i = Number(topNext.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });

  // keyboard nav (ignore inputs)
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

  /* LOAD CHAPTER LIST */
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

  /* LOAD SINGLE CHAPTER and restore scroll if reloaded */
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

      // Restore scroll only if a sessionStorage entry exists (meaning user reloaded)
      try {
        const key = 'scroll:' + filename;
        const v = sessionStorage.getItem(key);
        if (v !== null) {
          // small delay to allow layout/images to settle
          const scrollVal = Number(v) || 0;
          // use two rAFs to wait for layout, then scroll
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.scrollTo({ top: scrollVal, behavior: 'auto' });
              // Remove saved scroll so subsequent in-page navigation won't pick it up
              try { sessionStorage.removeItem(key); } catch (e) {}
              // ensure top arrows reflect the restored position
              if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
            });
          });
        } else {
          // no saved scroll: after loading a chapter, if we're at top, ensure top nav visible (fix for next-chapter bug)
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
      console.debug('tippy-img: trying direct', srcCandidate);
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
      console.debug('tippy-img: testing', u);
      if (await testImageUrl(u)) {
        console.debug('tippy-img: resolved', srcCandidate, '->', u);
        resolvedUrlCache.set(srcCandidate, u);
        return u;
      }
    }

    console.debug('tippy-img: none resolved for', srcCandidate);
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
          console.debug('tippy-img: preloading', resolved);
          preloadedImgCache.set(resolved, pimg);
          pimg.onload = () => { console.debug('tippy-img: preloaded', resolved); };
          pimg.onerror = () => { console.warn('tippy-img: preload failed', resolved); preloadedImgCache.delete(resolved); };
          pimg.src = resolved;
        }
      } catch (err) {
        console.debug('tippy-img: preload error for', dataImg, err);
      }
    }
  }

  // re-preload when the document becomes visible (browser may have evicted cached Image objects)
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
            pimg.onload = () => { console.debug('tippy-img: re-preloaded', resolved); };
            pimg.onerror = () => { console.warn('tippy-img: re-preload failed', resolved); preloadedImgCache.delete(resolved); };
            pimg.src = resolved;
          } catch (e) { /* ignore */ }
        }
      });
    }
  });

  /* ---------------- TIPPY init for .gloss ---------------- */
  function initGlossTippy() {
    if (!window.tippy) return;
    document.querySelectorAll('.gloss').forEach(el => { try { if (el._tippy) el._tippy.destroy(); } catch (e) { } });

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
          // ensure a preloaded object exists (re-create if necessary)
          if (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete) {
            try {
              const pimg = new Image();
              pimg.crossOrigin = 'anonymous';
              pimg.decoding = 'async';
              preloadedImgCache.set(resolved, pimg);
              pimg.onload = () => { console.debug('tippy-img: onShow preloaded', resolved); };
              pimg.onerror = () => { console.warn('tippy-img: onShow preload failed', resolved); preloadedImgCache.delete(resolved); };
              pimg.src = resolved;
            } catch (e) { /* ignore */ }
          }

          const imgEl = document.createElement('img');
          imgEl.className = 'tooltip-img';
          imgEl.src = resolved;
          imgEl.alt = imgAlt;
          imgEl.loading = 'eager';
          imgEl.style.cursor = 'pointer';
          imgEl.addEventListener('click', (ev) => {
            ev.stopPropagation();
            try { openImageViewer(resolved, imgAlt); } catch (e) { console.error(e); }
            try { instance.hide(); } catch (e) { /* ignore */ }
          });
          imgEl.addEventListener('load', () => {
            try {
              if (instance.popperInstance && typeof instance.popperInstance.update === 'function') instance.popperInstance.update();
              else if (typeof instance.update === 'function') instance.update();
            } catch (e) { /* ignore */ }
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
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if (!btn) return; try { if (btn._tippy) btn._tippy.destroy(); } catch (e) { } });

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
  const HIDE_DELAY_MS = 1000; // one second delay

  function clearHideTimer() {
    if (hideDelayTimer) { clearTimeout(hideDelayTimer); hideDelayTimer = null; }
  }

  function bottomNavIsVisible() {
    if (!bottomNav) return false;
    const r = bottomNav.getBoundingClientRect();
    return (r.top < window.innerHeight) && (r.bottom > 0);
  }

  function showTopNavImmediate() {
    // Do not show if bottom nav is visible
    if (bottomNavIsVisible()) {
      hideTopNavImmediate();
      return;
    }
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
      // Cancel hide and show immediately
      clearHideTimer();
      showTopNavImmediate();
    } else {
      // scrolling down -> schedule hide after 1s
      scheduleHideTopNav();
    }

    lastScrollY = curY;
  }

  // scroll handler with rAF batching
  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { onScrollCheck(); scheduled = false; });
  }, { passive: true });

  window.addEventListener('resize', () => { positionTopNav(); onScrollCheck(); });

  // observer: if bottom nav intersects viewport, hide top nav
  const observer = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(en => en.isIntersecting);
    if (anyVisible) hideTopNavImmediate();
  }, { root: null, threshold: 0.01 });
  if (bottomNav) observer.observe(bottomNav);

  function initialTopNavSetup() {
    positionTopNav();
    // If page is at top on load, always show top nav immediately (especially after reload)
    if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
    else hideTopNavImmediate();
  }
  // call immediately and again shortly after for layout-stabilization
  initialTopNavSetup();
  setTimeout(initialTopNavSetup, 80);

  /* ---------------- Image viewer (unchanged behavior, slight defensive sizing) ---------------- */
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

  /* ---------------- tippy preload/resolution functions reused above (already present) ---------------- */
  // (resolveTooltipImage, testImageUrl, preloadTooltipImages defined earlier)

  /* ---------------- Persist scroll only on unload (sessionStorage) ---------------- */
  // Save current scroll position on beforeunload for the currently-open chapter file.
  window.addEventListener('beforeunload', () => {
    try {
      if (currentIndex >= 0 && chapters[currentIndex] && chapters[currentIndex].file) {
        const key = 'scroll:' + chapters[currentIndex].file;
        sessionStorage.setItem(key, String(window.scrollY || 0));
      }
    } catch (e) {
      // best-effort, ignore errors
    }
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
  // position top nav once more shortly after load to ensure correct placement
  setTimeout(() => { positionTopNav(); if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); }, 120);
});

// COLOR PALETTE UI: open palette from top button, persist chosen color in localStorage
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('theme-toggle');
    const modal = document.getElementById('color-modal');
    const colorInput = document.getElementById('color-input');
    const applyBtn = document.getElementById('color-apply');
    const resetBtn = document.getElementById('color-reset');
    const closeBtn = document.getElementById('color-close');
    const swatches = Array.from(document.querySelectorAll('.color-swatch'));

    if (!toggleBtn || !modal || !colorInput || !applyBtn || !resetBtn || !closeBtn) return;

    // Get default color from CSS --bg-dark (the "current dark mode uses")
    const computed = getComputedStyle(document.documentElement);
    const defaultColor = (computed.getPropertyValue('--bg-dark') || '#0b0f13').trim();

    // Apply color and persist (localStorage)
    function applyColor(color) {
      if (!color) return;
      document.documentElement.style.setProperty('--bg', color);
      try { localStorage.setItem('custom-bg-color', color); } catch (e) { /* ignore */ }
    }
    // Reset: restore default dark-mode color (and remove storage)
    function resetColorToDefault() {
      document.documentElement.style.setProperty('--bg', defaultColor);
      try { localStorage.removeItem('custom-bg-color'); } catch (e) { /* ignore */ }
    }

    // Open/close helpers
    function openModal() {
      // set initial input value to currently stored or default
      const stored = localStorage.getItem('custom-bg-color');
      const initial = stored || defaultColor;
      // ensure valid hex when possible; color input requires hex, so try to convert rgb -> hex if necessary
      function toHexIfNeeded(val){
        if(!val) return initial;
        val = val.trim();
        if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val)) return val;
        // attempt parse rgb(a)
        const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if(m) {
          const r = (+m[1]).toString(16).padStart(2,'0');
          const g = (+m[2]).toString(16).padStart(2,'0');
          const b = (+m[3]).toString(16).padStart(2,'0');
          return `#${r}${g}${b}`;
        }
        return initial;
      }
      colorInput.value = toHexIfNeeded(initial);
      modal.setAttribute('aria-hidden', 'false');
      // trap focus briefly
      colorInput.focus();
      document.body.style.overflow = 'hidden';
    }
    function closeModal() {
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      toggleBtn.focus();
    }

    // Handlers
    toggleBtn.addEventListener('click', (e) => { e.preventDefault(); openModal(); });

    applyBtn.addEventListener('click', () => {
      const val = colorInput.value;
      if (val) { applyColor(val); }
      closeModal();
    });

    resetBtn.addEventListener('click', () => {
      resetColorToDefault();
      // update input to default
      colorInput.value = defaultColor;
      closeModal();
    });

    closeBtn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });

    // click outside to close
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) closeModal();
    });

    // Esc to close
    window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closeModal(); });

    // swatch clicks
    swatches.forEach(s => {
      s.addEventListener('click', (ev) => {
        const c = s.dataset.color;
        if (c) {
          // set input and immediately apply so user sees preview while modal open
          colorInput.value = c;
        }
      });
    });

    // on load, apply stored color if any (persist between sessions)
    try {
      const stored = localStorage.getItem('custom-bg-color');
      if (stored) {
        // if stored is not a hex, best-effort convert/rgb->hex is handled by applyColor using same override
        applyColor(stored);
      } else {
        // ensure default background uses --bg-dark by default
        document.documentElement.style.setProperty('--bg', getComputedStyle(document.documentElement).getPropertyValue('--bg-dark').trim() || defaultColor);
      }
    } catch (e) {
      // ignore storage errors
      document.documentElement.style.setProperty('--bg', defaultColor);
    }
  });
})();
