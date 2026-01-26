// script.js - fixes: prevent click-toggle after drag, remove smoothing by CSS, favicon already added,
// and change sun glyph to ☀︎

document.addEventListener('DOMContentLoaded', () => {
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

  if(!chaptersListEl || !chapterBodyEl || !chapterTitleEl){
    console.error('Essential DOM elements missing. Check index.html IDs.');
    if(chapterBodyEl) chapterBodyEl.textContent = 'Ошибка: элементы страницы отсутствуют. Проверьте index.html.';
    return;
  }

  let chapters = [];
  let currentIndex = -1;

  /* THEME HANDLING */
  function applyTheme(theme){
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('site-theme', theme);
    setThemeIcon(theme);
  }
  function setThemeIcon(theme){
    if(!themeToggle) return;
    // Light-mode glyph changed to '☀︎'
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
    refreshTippyContents();
  }

  function goToChapter(index){
    if(!chapters || index < 0 || index >= chapters.length) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    window.scrollTo({ top: 0, behavior: 'auto' });
    closeChapters(); // slide back the chapters list when user navigates
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

      if(chapters.length) goToChapter(0);
      else {
        chapterBodyEl.textContent = 'В репозитории нет глав (chapters.json пуст).';
        updateNavButtons();
      }
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message + '\nПроверьте, что файл chapters.json существует в корне репозитория и содержит корректный JSON.';
      console.error('loadChapters error:', err);
      [bottomPrev, bottomNext, topPrev, topNext].forEach(b => { if(b) b.disabled = true; });
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

      // Init glossary tippy if present
      if(window.tippy) {
        tippy('.gloss', { allowHTML: true, interactive: true, delay: [100, 100] });
      }

      // re-bind image viewer to images inside content
      bindImagesToViewer();

      updateNavButtons();
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message + '\nПроверьте, что файл chapters/' + filename + ' существует.';
      console.error('loadChapter error:', err);
    }
  }

  /* TIPPY tooltips for nav buttons and helpers */
  function refreshTippyContents(){
    if(!window.tippy) return;
    // destroy existing instances to avoid duplicates
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

  /* --- Top nav position & visibility logic --- */

  function positionTopNav(){
    if(!topNav || !headerEl) return;
    const hRect = headerEl.getBoundingClientRect();
    const topNavRect = topNav.getBoundingClientRect();
    const top = Math.max(6, hRect.top + (hRect.height / 2) - (topNavRect.height / 2));
    topNav.style.top = `${top}px`;
  }

  let lastScrollY = window.scrollY;
  let scheduled = false;
  let hideDelayTimer = null;
  const HIDE_DELAY_MS = 2500;

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
    if(hideDelayTimer){ clearTimeout(hideDelayTimer); hideDelayTimer = null; }
    topNav.classList.remove('visible-top');
    topNav.setAttribute('aria-hidden', 'true');
  }

  function scheduleHideTopNavWithDelay(){
    if(hideDelayTimer) return;
    hideDelayTimer = setTimeout(() => {
      if(!bottomNavIsVisible()) hideTopNav();
      hideDelayTimer = null;
    }, HIDE_DELAY_MS);
  }

  function onScrollCheck(){
    const curY = window.scrollY;
    const scrollingUp = curY < lastScrollY;
    const atTop = curY <= 10;

    if(bottomNavIsVisible()){
      hideTopNav();
      if(hideDelayTimer){ clearTimeout(hideDelayTimer); hideDelayTimer = null; }
    } else if(atTop || scrollingUp){
      if(hideDelayTimer){ clearTimeout(hideDelayTimer); hideDelayTimer = null; }
      showTopNav();
    } else {
      scheduleHideTopNavWithDelay();
    }

    lastScrollY = curY;
  }

  window.addEventListener('scroll', () => {
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{ onScrollCheck(); scheduled = false; });
  }, { passive: true });

  window.addEventListener('resize', () => {
    positionTopNav();
    onScrollCheck();
  });

  const observer = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(en => en.isIntersecting);
    if(anyVisible) {
      hideTopNav();
    }
  }, { root: null, threshold: 0.01 });

  if(bottomNav) observer.observe(bottomNav);

  /* Ensure top nav is positioned and visibility checked after load */
  function initialTopNavSetup(){
    positionTopNav();
    if(window.scrollY <= 10 && !bottomNavIsVisible()){
      showTopNav();
    } else {
      hideTopNav();
    }
  }

  setTimeout(initialTopNavSetup, 40);

  /* --- Image viewer (click-to-zoom + drag) --- */

  const overlay = document.createElement('div');
  overlay.id = 'image-overlay';
  overlay.innerHTML = `<div class="viewer" role="dialog" aria-modal="true"><img class="viewer-img" src="" alt=""></div>`;
  document.body.appendChild(overlay);
  const overlayViewer = overlay.querySelector('.viewer');
  const overlayImg = overlay.querySelector('.viewer-img');

  let isZoomed = false;
  let dragging = false;
  let pointerDown = false;
  let pointerStart = { x: 0, y: 0 };
  let imgPos = { x: 0, y: 0 };
  let dragMoved = false;
  let suppressClick = false;
  const DRAG_THRESHOLD = 4; // pixels

  function openImageViewer(src, alt = ''){
    overlayImg.src = src;
    overlayImg.alt = alt || '';
    overlay.classList.add('visible');
    isZoomed = false;
    imgPos = { x: 0, y: 0 };
    applyImageTransform();
    overlayImg.classList.remove('zoomed');
    overlay.style.cursor = 'default';
    document.body.style.overflow = 'hidden';
  }

  function closeImageViewer(){
    overlay.classList.remove('visible');
    overlayImg.src = '';
    isZoomed = false;
    dragging = false;
    pointerDown = false;
    dragMoved = false;
    suppressClick = false;
    document.body.style.overflow = '';
  }

  function applyImageTransform(){
    const scale = isZoomed ? 2 : 1;
    overlayImg.style.transform = `translate(${imgPos.x}px, ${imgPos.y}px) scale(${scale})`;
    if(isZoomed) overlayImg.classList.add('zoomed'); else overlayImg.classList.remove('zoomed');
  }

  // Click toggles zoom but only if not suppressed by a drag
  overlayImg.addEventListener('click', (ev) => {
    if(suppressClick) {
      // reset suppress flag and ignore click
      suppressClick = false;
      return;
    }
    // toggle zoom on true click
    isZoomed = !isZoomed;
    if(!isZoomed){
      imgPos = { x: 0, y: 0 };
    }
    applyImageTransform();
  });

  // pointer handling for drag (mouse)
  overlayImg.addEventListener('mousedown', (ev) => {
    if(!isZoomed) return; // only allow dragging when zoomed
    ev.preventDefault();
    pointerDown = true;
    dragging = false;
    dragMoved = false;
    pointerStart = { x: ev.clientX, y: ev.clientY };
    overlayImg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (ev) => {
    if(!pointerDown || !isZoomed) return;
    const dx = ev.clientX - pointerStart.x;
    const dy = ev.clientY - pointerStart.y;
    if(!dragMoved && (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD)) {
      dragMoved = true;
      dragging = true;
    }
    if(dragMoved) {
      // update start point to current for smoother immediate dragging
      pointerStart = { x: ev.clientX, y: ev.clientY };
      imgPos.x += dx;
      imgPos.y += dy;
      applyImageTransform();
    }
  });

  window.addEventListener('mouseup', (ev) => {
    if(pointerDown && dragMoved){
      // if there was a drag, suppress the immediately-following click
      suppressClick = true;
      // clear it shortly after to avoid interfering with subsequent clicks
      setTimeout(() => { suppressClick = false; }, 0);
    }
    pointerDown = false;
    dragging = false;
    overlayImg.style.cursor = isZoomed ? 'grab' : 'zoom-in';
  });

  // Close on clicking outside the image or Escape
  overlay.addEventListener('click', (ev) => {
    if(ev.target === overlay) closeImageViewer();
  });
  window.addEventListener('keydown', (ev) => {
    if(ev.key === 'Escape' && overlay.classList.contains('visible')) closeImageViewer();
  });

  // Bind images inside chapter-body
  function bindImagesToViewer(){
    const imgs = chapterBodyEl.querySelectorAll('img');
    imgs.forEach(img => {
      // replace node to remove duplicate listeners if any
      const clone = img.cloneNode(true);
      clone.style.cursor = 'zoom-in';
      img.parentNode.replaceChild(clone, img);
      clone.addEventListener('click', (e) => {
        const src = clone.getAttribute('src') || clone.getAttribute('data-src') || '';
        if(!src) return;
        openImageViewer(src, clone.getAttribute('alt') || '');
      });
    });
  }

  /* Start: load chapters list */
  loadChapters();

  // initial nav update & positioning
  updateNavButtons();
  setTimeout(() => {
    positionTopNav();
    if(window.scrollY <= 10 && !bottomNavIsVisible()){
      showTopNav();
    }
  }, 120);

});
