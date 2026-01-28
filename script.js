// script.js - cleaned / consolidated single-file version
// Features:
// - load chapters.json, support "done" flag (undone entries are disabled/grayed)
// - slide-out chapters list from left, auto-close on chapter click
// - centered content area, top & bottom nav (top fades based on scroll, 2.5s hide delay)
// - tippy tooltips with top-banner images (preload and click-to-open viewer)
// - image viewer (click image to open, LMB toggles zoom, drag while zoomed, click outside or Esc to close)
// - theme toggle (☀︎ / ☾)

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

  // Basic validation
  if (!chaptersListEl || !chapterBodyEl || !chapterTitleEl) {
    console.error('Essential DOM elements missing. Check index.html IDs.');
    if (chapterBodyEl) chapterBodyEl.textContent = 'Ошибка: элементы страницы отсутствуют. Проверьте index.html.';
    return;
  }

  // App state
  let chapters = [];
  let currentIndex = -1;
  let lastChapterFile = null; // 'chapters/01.md' used to resolve relative tooltip image paths

  // Tooltip image caches
  const resolvedUrlCache = new Map(); // data-img => resolved absolute url or null
  const preloadedImgCache = new Map(); // resolved absolute url => HTMLImageElement (preloaded)

  /* ---------------- THEME ---------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('site-theme', theme);
    setThemeIcon(theme);
  }
  function setThemeIcon(theme) {
    if (!themeToggle) return;
    // show sun in dark (indicates toggle will switch to light), moon in light
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

  /* ---------------- HELPERS: done flag & nav ---------------- */
  function isDoneEntry(entry) {
    if (!entry) return false;
    return entry.done !== false; // default true unless explicitly false
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
      [bottomPrev, topPrev].forEach(btn => { if (btn) { btn.dataset.index = prevIndex; btn.dataset.title = p.title || ''; } });
    } else {
      [bottomPrev, topPrev].forEach(btn => { if (btn) { btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); } });
    }

    if (!nextDisabled) {
      const n = chapters[nextIndex];
      [bottomNext, topNext].forEach(btn => { if (btn) { btn.dataset.index = nextIndex; btn.dataset.title = n.title || ''; } });
    } else {
      [bottomNext, topNext].forEach(btn => { if (btn) { btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); } });
    }

    refreshNavTippies();
  }

  function goToChapter(index) {
    if (!chapters || index < 0 || index >= chapters.length) return;
    if (!isDoneEntry(chapters[index])) return; // don't navigate to undone
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    window.scrollTo({ top: 0, behavior: 'auto' });
    closeChapters();
  }

  // attach nav button handlers
  if (bottomPrev) bottomPrev.addEventListener('click', () => { const i = Number(bottomPrev.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (bottomNext) bottomNext.addEventListener('click', () => { const i = Number(bottomNext.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (topPrev) topPrev.addEventListener('click', () => { const i = Number(topPrev.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });
  if (topNext) topNext.addEventListener('click', () => { const i = Number(topNext.dataset.index); if (!Number.isNaN(i)) goToChapter(i); });

  // keyboard nav
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
      lastChapterFile = 'chapters/' + filename;
      const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: библиотека marked не загружена.</p>';
      chapterBodyEl.innerHTML = html;

      // Preload tooltip images, init tippies, bind inline images
      preloadTooltipImages();
      initGlossTippy();
      bindImagesToViewer();

      updateNavButtons();
    } catch (err) {
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
      console.error('loadChapter error:', err);
    }
  }

  /* ---------------- IMAGE RESOLUTION / TEST ---------------- */
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

    // direct absolute or root
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

  /* ---------------- TIPPY initialization for .gloss (banner image + preloaded use) ---------------- */
  function initGlossTippy() {
    if (!window.tippy) return;

    // destroy previous
    document.querySelectorAll('.gloss').forEach(el => { try { if (el._tippy) el._tippy.destroy(); } catch (e) { } });

    tippy('.gloss', {
      allowHTML: true,
      interactive: true,
      delay: [60, 80],
      maxWidth: 520,
      placement: 'top',
      offset: [0, 8],
      appendTo: () => document.body,
      popperOptions: { strategy: 'fixed' },
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
          const cachedImg = preloadedImgCache.get(resolved);
          const makeImageElement = () => {
            const imgEl = document.createElement('img');
            imgEl.className = 'tooltip-img';
            imgEl.src = resolved;
            imgEl.alt = imgAlt;
            imgEl.loading = 'eager';
            imgEl.style.cursor = 'pointer';
            imgEl.addEventListener('click', (ev) => {
              ev.stopPropagation();
              try { openImageViewer(resolved, imgAlt); } catch (e) { console.error(e); }
              try { instance.hide(); } catch (e) { }
            });
            imgEl.addEventListener('load', () => {
              // update popper to reposition
              try {
                if (instance.popperInstance && typeof instance.popperInstance.update === 'function') instance.popperInstance.update();
                else if (typeof instance.update === 'function') instance.update();
              } catch (e) { }
            });
            return imgEl;
          };

          // If preloaded element exists and is complete, create a fresh img using that src
          if (cachedImg && cachedImg.complete) {
            wrapper.appendChild(makeImageElement());
          } else {
            wrapper.appendChild(makeImageElement());
          }
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'tooltip-body';
        contentDiv.innerHTML = contentHTML;
        wrapper.appendChild(contentDiv);

        try { instance.setContent(wrapper); } catch (e) { instance.setContent(wrapper.outerHTML); }
      }
    });
  }

  /* ---------------- Nav button tippies ---------------- */
  function refreshNavTippies() {
    if (!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if (!btn) return; try { if (btn._tippy) btn._tippy.destroy(); } catch (e) { } });

    if (bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
    if (topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80, 40], offset: [0, 8], appendTo: () => document.body });
  }

  /* ---------------- Chapters aside slide-in/out ---------------- */
  let chaptersOpen = false;
  const EDGE_TRIGGER_PX = 12;
  function openChapters() { if (chaptersOpen) return; chaptersOpen = true; document.body.classList.add('chapters-open'); }
  function closeChapters() { if (!chaptersOpen) return; chaptersOpen = false; document.body.classList.remove('chapters-open'); }

  document.addEventListener('mousemove', (e) => { if (window.innerWidth <= 700) return; if (e.clientX <= EDGE_TRIGGER_PX) openChapters(); });
  if (chaptersAside) {
    chaptersAside.addEventListener('mouseenter', openChapters);
    chaptersAside.addEventListener('mouseleave', (ev) => { if (ev.clientX <= EDGE_TRIGGER_PX) return; closeChapters(); });
  }
  document.addEventListener('click', (e) => {
    if (!chaptersOpen) return;
    if (chaptersAside && chaptersAside.contains(e.target)) return;
    if (e.clientX <= EDGE_TRIGGER_PX) return;
    closeChapters();
  });

  /* ---------------- Top nav visibility logic ---------------- */
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
  const HIDE_DELAY_MS = 2500;

  function bottomNavIsVisible() {
    if (!bottomNav) return false;
    const r = bottomNav.getBoundingClientRect();
    return (r.top < window.innerHeight) && (r.bottom > 0);
  }
  function showTopNav() {
    if (bottomNavIsVisible()) { hideTopNav(); return; }
    topNav.classList.add('visible-top');
    topNav.setAttribute('aria-hidden', 'false');
  }
  function hideTopNav() {
    if (hideDelayTimer) { clearTimeout(hideDelayTimer); hideDelayTimer = null; }
    topNav.classList.remove('visible-top');
    topNav.setAttribute('aria-hidden', 'true');
  }
  function scheduleHideTopNavWithDelay() {
    if (hideDelayTimer) return;
    hideDelayTimer = setTimeout(() => { if (!bottomNavIsVisible()) hideTopNav(); hideDelayTimer = null; }, HIDE_DELAY_MS);
  }

  function onScrollCheck() {
    const curY = window.scrollY;
    const scrollingUp = curY < lastScrollY;
    const atTop = curY <= 10;

    if (bottomNavIsVisible()) {
      hideTopNav();
      if (hideDelayTimer) { clearTimeout(hideDelayTimer); hideDelayTimer = null; }
    } else if (atTop || scrollingUp) {
      if (hideDelayTimer) { clearTimeout(hideDelayTimer); hideDelayTimer = null; }
      showTopNav();
    } else {
      scheduleHideTopNavWithDelay();
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
    if (anyVisible) hideTopNav();
  }, { root: null, threshold: 0.01 });

  if (bottomNav) observer.observe(bottomNav);

  function initialTopNavSetup() {
    positionTopNav();
    if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNav(); else hideTopNav();
  }
  setTimeout(initialTopNavSetup, 40);

  /* ---------------- Image viewer (lightbox) ---------------- */
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

    // defensive inline sizing to ensure large images fit
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

  /* ---------------- START ---------------- */
  loadChapters();
  updateNavButtons();
  setTimeout(() => {
    positionTopNav();
    if (window.scrollY <= 10 && !bottomNavIsVisible()) showTopNav();
  }, 120);

});
