// script.js - top-nav positioning, delayed hide behavior, tooltip color, image viewer, slide-back chapters
document.addEventListener('DOMContentLoaded', () => {
  const chaptersListEl = document.getElementById('chapters');
  const chapterBodyEl = document.getElementById('chapter-body');
  const chapterTitleEl = document.getElementById('chapter-title');
  const themeToggle = document.getElementById('theme-toggle');

  const bottomPrev = document.getElementById('bottom-prev');
  const bottomNext = document.getElementById('bottom-next');
  const bottomNav = document.getElementById('bottom-nav');

  const topPrev = document.getElementById('top-prev');
  const topNext = document.getElementById('top-next');
  const topNav = document.getElementById('top-nav');

  const chaptersAside = document.getElementById('chapters-list');
  const headerEl = document.querySelector('header');

  if(!chaptersListEl || !chapterBodyEl || !chapterTitleEl){
    console.error('Essential DOM elements missing. Check index.html IDs.');
    if(chapterBodyEl) chapterBodyEl.textContent = 'Ошибка: элементы страницы отсутствуют. Проверьте index.html.';
    return;
  }

  let chapters = [];
  let currentIndex = -1;

  /* THEME HANDLING (unchanged) */
  function applyTheme(theme){
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('site-theme', theme);
    setThemeIcon(theme);
  }
  function setThemeIcon(theme){
    if(!themeToggle) return;
    themeToggle.textContent = (theme === 'dark') ? '☀︎' : '☾';
    themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }
  function toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }
  (function initTheme(){
    const saved = localStorage.getItem('site-theme');
    applyTheme(saved === 'light' ? 'light' : 'dark');
  })();
  if(themeToggle){
    themeToggle.addEventListener('click', toggleTheme);
  }

  /* NAV BUTTONS handling (top & bottom) */
  function updateNavButtons(){
    const hasChapters = Array.isArray(chapters) && chapters.length > 0;
    const prevDisabled = !hasChapters || currentIndex <= 0;
    const nextDisabled = !hasChapters || currentIndex >= chapters.length - 1;

    [bottomPrev, topPrev].forEach(btn => { if(btn) btn.disabled = prevDisabled; });
    [bottomNext, topNext].forEach(btn => { if(btn) btn.disabled = nextDisabled; });

    if(hasChapters && currentIndex >= 0){
      const prevIndex = Math.max(0, currentIndex - 1);
      const nextIndex = Math.min(chapters.length - 1, currentIndex + 1);

      const prevTitle = chapters[prevIndex] ? chapters[prevIndex].title : '';
      const nextTitle = chapters[nextIndex] ? chapters[nextIndex].title : '';

      if(bottomPrev){ bottomPrev.dataset.index = prevIndex; bottomPrev.dataset.title = prevTitle; }
      if(bottomNext){ bottomNext.dataset.index = nextIndex; bottomNext.dataset.title = nextTitle; }
      if(topPrev){ topPrev.dataset.index = prevIndex; topPrev.dataset.title = prevTitle; }
      if(topNext){ topNext.dataset.index = nextIndex; topNext.dataset.title = nextTitle; }
    } else {
      [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if(btn){ btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }});
    }

    // refresh nav tooltips
    refreshTippyContents();
  }

  // Click handlers
  function goToChapter(index){
    if(!chapters || index < 0 || index >= chapters.length) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    // move viewport to top of content area
    window.scrollTo({ top: 0 });
    // close chapters list when user navigates via the chapter list
    closeChapters();
  }

  if(bottomPrev) bottomPrev.addEventListener('click', ()=> { const i = Number(bottomPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(bottomNext) bottomNext.addEventListener('click', ()=> { const i = Number(bottomNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topPrev) topPrev.addEventListener('click', ()=> { const i = Number(topPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topNext) topNext.addEventListener('click', ()=> { const i = Number(topNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });

  // Keyboard nav (ignore when focusing inputs)
  document.addEventListener('keydown', (e)=>{
    const active = document.activeElement;
    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if(e.key === 'ArrowLeft' && currentIndex > 0) goToChapter(currentIndex - 1);
    if(e.key === 'ArrowRight' && currentIndex < chapters.length - 1) goToChapter(currentIndex + 1);
    if(e.key === 'Escape') closeImageViewer();
  });

  /* Load chapters.json and build list */
  async function loadChapters(){
    chapterBodyEl.textContent = 'Загрузка...';
    try{
      const res = await fetch('chapters.json', {cache: 'no-store'});
      if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching chapters.json');
      const data = await res.json();
      if(!Array.isArray(data)) throw new Error('chapters.json is not an array');
      chapters = data;
      chaptersListEl.innerHTML = '';

      chapters.forEach((c, i)=>{
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = c.title || `Глава ${i+1}`;
        a.addEventListener('click', (e)=>{ e.preventDefault(); goToChapter(i); });
        li.appendChild(a);
        chaptersListEl.appendChild(li);
      });

      if(chapters.length) {
        goToChapter(0);
      } else {
        chapterBodyEl.textContent = 'В репозитории нет глав (chapters.json пуст).';
        updateNavButtons();
      }
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message + '\nПроверьте, что файл chapters.json существует в корне репозитория и содержит корректный JSON.';
      console.error('loadChapters error:', err);
      [bottomPrev, bottomNext, topPrev, topNext].forEach(b => { if(b) b.disabled = true; });
    } finally {
      // ensure top nav is positioned and visibility correct after chapters load (addresses issue #2)
      positionTopNav();
      onScrollCheckImmediate();
    }
  }

  /* Load single chapter */
  async function loadChapter(filename, title){
    chapterTitleEl.textContent = title || '';
    chapterBodyEl.textContent = 'Загрузка главы...';
    try{
      const res = await fetch('chapters/' + filename, {cache: 'no-store'});
      if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + filename);
      const md = await res.text();
      const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: библиотека marked не загружена.</p>';
      chapterBodyEl.innerHTML = html;
      // Init tippy on glossary spans (if loaded)
      if(window.tippy) {
        tippy('.gloss', { allowHTML: true, interactive: true, delay: [100, 100] });
      }
      updateNavButtons();
      // ensure top nav is placed correctly after content changes
      positionTopNav();
      onScrollCheckImmediate();
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message + '\nПроверьте, что файл chapters/' + filename + ' существует.';
      console.error('loadChapter error:', err);
    }
  }

  /* TIPPY tooltips for nav buttons (bottom: top placement, top: bottom placement) */
  function refreshTippyContents(){
    if(!window.tippy) return;
    // destroy existing _tippy instances to avoid duplicates
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => {
      if(!btn) return;
      try{ if(btn._tippy) btn._tippy.destroy(); }catch(e){}
    });

    if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8] });
    if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8] });
    if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8] });
    if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8] });
  }

  /* Chapters aside slide-in/out behavior */
  let chaptersOpen = false;
  const EDGE_TRIGGER_PX = 12;

  function openChapters(){
    if(chaptersOpen) return;
    chaptersOpen = true;
    document.body.classList.add('chapters-open');
  }
  function closeChapters(){
    if(!chaptersOpen) return;
    chaptersOpen = false;
    document.body.classList.remove('chapters-open');
  }

  // Open when mouse near left edge (desktop only)
  document.addEventListener('mousemove', (e) => {
    if(window.innerWidth <= 700) return;
    if(e.clientX <= EDGE_TRIGGER_PX) openChapters();
  });

  if(chaptersAside){
    chaptersAside.addEventListener('mouseenter', openChapters);
    chaptersAside.addEventListener('mouseleave', (ev) => {
      if(ev.clientX <= EDGE_TRIGGER_PX) return;
      closeChapters();
    });
  }

  document.addEventListener('click', (e) => {
    if(!chaptersOpen) return;
    if(chaptersAside && chaptersAside.contains(e.target)) return;
    if(e.clientX <= EDGE_TRIGGER_PX) return;
    closeChapters();
  });

  /* Scroll behaviour for top nav:
     - Show top nav when user scrolls UP or is at top.
     - When user scrolls DOWN, schedule hiding after HIDE_DELAY ms (2.5s).
     - If user scrolls up during the delay, cancel hide.
     - If bottom nav becomes visible, hide immediately and cancel timer.
     - When at top on load, top nav will be shown immediately.
  */
  let lastScrollY = window.scrollY;
  const HIDE_DELAY = 2500; // 2.5 seconds
  let hideTimer = null;

  function bottomNavIsVisible(){
    if(!bottomNav) return false;
    const r = bottomNav.getBoundingClientRect();
    return (r.top < window.innerHeight) && (r.bottom > 0);
  }

  function showTopNav(){
    if(bottomNavIsVisible()){
      hideTopNav();
      return;
    }
    topNav.classList.add('visible-top');
    topNav.setAttribute('aria-hidden', 'false');
  }

  function hideTopNav(){
    topNav.classList.remove('visible-top');
    topNav.setAttribute('aria-hidden', 'true');
  }

  function scheduleHideTopNav(){
    if(hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      // hide only if bottom nav isn't visible and user hasn't scrolled up since scheduling
      if(!bottomNavIsVisible()) hideTopNav();
    }, HIDE_DELAY);
  }

  function cancelScheduledHide(){
    if(hideTimer){ clearTimeout(hideTimer); hideTimer = null; }
  }

  function onScrollCheck(){
    const curY = window.scrollY;
    const scrollingUp = curY < lastScrollY;
    const atTop = curY <= 10;

    if(bottomNavIsVisible()){
      cancelScheduledHide();
      hideTopNav();
    } else if(atTop || scrollingUp){
      // cancel any pending hide and show immediately
      cancelScheduledHide();
      showTopNav();
    } else {
      // scrolling down -> schedule hide after delay
      scheduleHideTopNav();
    }

    lastScrollY = curY;
  }

  // immediate check (no rAF) used when we need to evaluate on load
  function onScrollCheckImmediate(){
    lastScrollY = window.scrollY;
    onScrollCheck();
  }

  // throttled scroll handler
  let scheduled = false;
  window.addEventListener('scroll', () => {
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{ onScrollCheck(); scheduled = false; });
  }, { passive: true });

  window.addEventListener('resize', () => {
    positionTopNav();
    onScrollCheck();
  });

  // Intersection observer to hide top nav when bottom nav intersects viewport
  const observer = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(en => en.isIntersecting);
    if(anyVisible){
      cancelScheduledHide();
      hideTopNav();
    }
  }, { root: null, threshold: 0.01 });

  if(bottomNav) observer.observe(bottomNav);

  /* positionTopNav: set top-nav y coordinate to align with header's "top line"
     We compute header's vertical center and set topNav.style.top accordingly.
  */
  function positionTopNav(){
    if(!headerEl || !topNav) return;
    const rect = headerEl.getBoundingClientRect();
    // pick a vertical position that aligns the nav vertically centered with the header's content area
    const headerCenter = rect.top + (rect.height / 2);
    // apply top as px so the fixed element lines up correctly
    topNav.style.top = `${Math.round(headerCenter)}px`;
  }

  /* TIPPY init for nav buttons (and gloss) */
  function refreshTippyContents(){
    if(!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => {
      if(!btn) return;
      try{ if(btn._tippy) btn._tippy.destroy(); }catch(e){}
    });
    if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8] });
    if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8] });
    if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8] });
    if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8] });
  }

  /* --- Image viewer (lightbox) implementation --- */
  // Create overlay DOM once
  const overlay = document.createElement('div');
  overlay.id = 'image-viewer-overlay';
  overlay.innerHTML = `
    <div id="image-viewer-wrap">
      <img id="image-viewer-img" src="" alt="">
      <div id="image-viewer-caption"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const viewerWrap = document.getElementById('image-viewer-wrap');
  const viewerImg = document.getElementById('image-viewer-img');
  const viewerCaption = document.getElementById('image-viewer-caption');

  let viewerState = {
    scale: 1,
    minScale: 0.5,
    maxScale: 6,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
    dragging: false,
    pointerId: null
  };

  function openImageViewer(src, alt){
    viewerImg.src = src;
    viewerImg.alt = alt || '';
    viewerCaption.textContent = alt || '';
    viewerState.scale = 1;
    viewerState.offsetX = 0;
    viewerState.offsetY = 0;
    updateViewerTransform();
    overlay.classList.add('visible');
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overflow = 'hidden';
  }

  function closeImageViewer(){
    overlay.classList.remove('visible');
    viewerImg.src = '';
    document.body.style.overscrollBehavior = '';
    document.documentElement.style.overflow = '';
  }

  function updateViewerTransform(){
    viewerImg.style.transform = `translate(${viewerState.offsetX}px, ${viewerState.offsetY}px) scale(${viewerState.scale})`;
  }

  // wheel to zoom (desktop)
  overlay.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const delta = -ev.deltaY;
    // zoom factor
    const factor = 1 + (delta > 0 ? 0.12 : -0.12);
    const newScale = Math.max(viewerState.minScale, Math.min(viewerState.maxScale, viewerState.scale * factor));
    // compute focus point to zoom towards mouse (optional enhancement)
    const rect = viewerImg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const px = (mx - rect.width / 2) / rect.width;
    const py = (my - rect.height / 2) / rect.height;

    // adjust offsets slightly so zoom appears toward cursor
    viewerState.offsetX -= px * rect.width * (newScale - viewerState.scale);
    viewerState.offsetY -= py * rect.height * (newScale - viewerState.scale);

    viewerState.scale = newScale;
    updateViewerTransform();
  }, { passive: false });

  // mouse drag to pan
  viewerImg.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    viewerState.dragging = true;
    viewerImg.classList.add('dragging');
    viewerState.startX = ev.clientX - viewerState.offsetX;
    viewerState.startY = ev.clientY - viewerState.offsetY;
    viewerState.pointerId = 'mouse';
  });

  window.addEventListener('mousemove', (ev) => {
    if(!viewerState.dragging) return;
    viewerState.offsetX = ev.clientX - viewerState.startX;
    viewerState.offsetY = ev.clientY - viewerState.startY;
    updateViewerTransform();
  });

  window.addEventListener('mouseup', () => {
    if(!viewerState.dragging) return;
    viewerState.dragging = false;
    viewerImg.classList.remove('dragging');
    viewerState.pointerId = null;
  });

  // touch pan (single finger)
  viewerImg.addEventListener('touchstart', (ev) => {
    if(ev.touches.length === 1){
      const t = ev.touches[0];
      viewerState.dragging = true;
      viewerState.startX = t.clientX - viewerState.offsetX;
      viewerState.startY = t.clientY - viewerState.offsetY;
      viewerState.pointerId = t.identifier;
    }
  }, { passive: true });

  viewerImg.addEventListener('touchmove', (ev) => {
    if(!viewerState.dragging) return;
    const t = ev.touches[0];
    viewerState.offsetX = t.clientX - viewerState.startX;
    viewerState.offsetY = t.clientY - viewerState.startY;
    updateViewerTransform();
  }, { passive: true });

  viewerImg.addEventListener('touchend', (ev) => {
    viewerState.dragging = false;
    viewerState.pointerId = null;
  });

  // double click/double tap to reset zoom
  viewerImg.addEventListener('dblclick', (ev) => {
    viewerState.scale = 1;
    viewerState.offsetX = 0;
    viewerState.offsetY = 0;
    updateViewerTransform();
  });

  // click overlay outside image to close
  overlay.addEventListener('click', (ev) => {
    if(ev.target === overlay) closeImageViewer();
  });

  // close on Esc (handled in keydown above)

  /* Delegate clicks on chapter images to open viewer */
  chapterBodyEl.addEventListener('click', (ev) => {
    const t = ev.target;
    if(t && t.tagName === 'IMG'){
      const src = t.getAttribute('src') || t.currentSrc;
      const alt = t.getAttribute('alt') || '';
      if(src){
        openImageViewer(src, alt);
      }
    }
  });

  /* Helper to initialize tippy-gloss and top/bottom nav tippies */
  function initTippyGlossAndNav(){
    // gloss spans
    if(window.tippy){
      try{ tippy('.gloss', { allowHTML: true, interactive: true, delay: [100, 100] }); }catch(e){}
    }
    refreshTippyContents();
  }

  /* --- Top nav position & initial visibility --- */
  function positionTopNav(){
    if(!headerEl || !topNav) return;
    const rect = headerEl.getBoundingClientRect();
    const headerCenter = rect.top + (rect.height / 2);
    topNav.style.top = `${Math.round(headerCenter)}px`;
  }

  /* Start: load chapters and initialize UI */
  loadChapters();

  // after DOM ready set top nav position and tippy
  positionTopNav();
  initTippyGlossAndNav();
  onScrollCheckImmediate();
});
