// script.js - consolidated: chapter loader, theme, slide-out chapters, nav, tippy tooltips with top images
// Updated: tooltips now append to document.body and explicitly decode images on show so they render reliably.

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

  /* Helper: interpret 'done' property — default true if missing */
  function isDoneEntry(entry){
    if(!entry) return false;
    return entry.done !== false;
  }

  /* NAV helpers */
  function findPrevDoneIndex(fromIndex){
    for(let i = (fromIndex === undefined ? currentIndex - 1 : fromIndex); i >= 0; i--){
      if(isDoneEntry(chapters[i])) return i;
    }
    return -1;
  }
  function findNextDoneIndex(fromIndex){
    for(let i = (fromIndex === undefined ? currentIndex + 1 : fromIndex); i < chapters.length; i++){
      if(isDoneEntry(chapters[i])) return i;
    }
    return -1;
  }
  function findFirstDoneIndex(){
    return findNextDoneIndex(0);
  }

  /* NAV BUTTONS handling */
  function updateNavButtons(){
    const prevIndex = findPrevDoneIndex();
    const nextIndex = findNextDoneIndex();
    const prevDisabled = prevIndex === -1;
    const nextDisabled = nextIndex === -1;

    [bottomPrev, topPrev].forEach(btn => { if(btn) btn.disabled = prevDisabled; });
    [bottomNext, topNext].forEach(btn => { if(btn) btn.disabled = nextDisabled; });

    if(!prevDisabled){
      const p = chapters[prevIndex];
      [bottomPrev, topPrev].forEach(btn => { if(btn){ btn.dataset.index = prevIndex; btn.dataset.title = p.title || ''; }});
    } else {
      [bottomPrev, topPrev].forEach(btn => { if(btn){ btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }});
    }

    if(!nextDisabled){
      const n = chapters[nextIndex];
      [bottomNext, topNext].forEach(btn => { if(btn){ btn.dataset.index = nextIndex; btn.dataset.title = n.title || ''; }});
    } else {
      [bottomNext, topNext].forEach(btn => { if(btn){ btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }});
    }

    refreshTippyContents();
  }

  function goToChapter(index){
    if(!chapters || index < 0 || index >= chapters.length) return;
    if(!isDoneEntry(chapters[index])) return; // prevent navigation to undone
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    window.scrollTo({ top: 0, behavior: 'auto' });
    closeChapters();
  }

  if(bottomPrev) bottomPrev.addEventListener('click', ()=> { const i = Number(bottomPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(bottomNext) bottomNext.addEventListener('click', ()=> { const i = Number(bottomNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topPrev) topPrev.addEventListener('click', ()=> { const i = Number(topPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topNext) topNext.addEventListener('click', ()=> { const i = Number(topNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });

  // Keyboard nav
  document.addEventListener('keydown', (e)=>{
    const active = document.activeElement;
    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if(e.key === 'ArrowLeft'){
      const prev = findPrevDoneIndex();
      if(prev !== -1) goToChapter(prev);
    }
    if(e.key === 'ArrowRight'){
      const next = findNextDoneIndex();
      if(next !== -1) goToChapter(next);
    }
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

        if(!isDoneEntry(c)){
          a.classList.add('undone');
        } else {
          a.addEventListener('click', (e)=>{ e.preventDefault(); goToChapter(i); });
        }

        li.appendChild(a);
        chaptersListEl.appendChild(li);
      });

      // pick initial chapter: first done chapter if any
      const first = findFirstDoneIndex();
      if(first !== -1) goToChapter(first);
      else {
        chapterBodyEl.textContent = 'В репозитории нет доступных (done) глав.';
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

      // Init glossary tippy (with top-image support)
      initGlossTippy();

      // re-bind image viewer to images inside content
      bindImagesToViewer();

      updateNavButtons();
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message + '\nПроверьте, что файл chapters/' + filename + ' существует.';
      console.error('loadChapter error:', err);
    }
  }

  /* Utility: normalize image URLs (github blob -> raw) */
  function normalizeImageUrl(url){
    if(!url || typeof url !== 'string') return url || '';
    let u = url.trim();
    try {
      const GH_BLOB = '/blob/';
      if(u.includes('github.com') && u.includes(GH_BLOB)){
        u = u.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace(GH_BLOB, '/');
      }
    } catch(e){}
    return u;
  }

  /* --- TIPPY tooltip initialization for glossary items (preload + appendTo + decode on show) --- */
  function initGlossTippy(){
    if(!window.tippy) return;

    // destroy previous instances on .gloss elements to avoid duplicates
    const existing = document.querySelectorAll('.gloss');
    existing.forEach(el => {
      try{ if(el._tippy) el._tippy.destroy(); }catch(e){}
    });

    tippy('.gloss', {
      allowHTML: true,
      interactive: true,
      delay: [100, 120],
      maxWidth: 360,
      appendTo: () => document.body, // ensure tooltip is appended to body (prevents clipping)
      content(reference){
        // prefer data-tippy-content, then title (and remove title), then innerHTML
        let contentHTML = reference.getAttribute('data-tippy-content') || reference.getAttribute('data-tip') || reference.getAttribute('title') || reference.innerHTML || '';
        if(reference.getAttribute('title')) reference.removeAttribute('title');

        const rawImg = reference.getAttribute('data-img') || '';
        const imgSrc = normalizeImageUrl(rawImg);
        const imgAlt = reference.getAttribute('data-img-alt') || '';

        // Preload image if provided to guarantee network request (helps with rendering)
        if(imgSrc){
          try {
            const pre = new Image();
            pre.src = imgSrc;
          } catch(e){}
        }

        // Build HTML string (image first if present)
        let out = '';
        if(imgSrc){
          const safeAlt = String(imgAlt).replace(/"/g, '&quot;');
          out += `<img class="tooltip-img" src="${imgSrc}" alt="${safeAlt}" loading="lazy">`;
        }
        out += `<div class="tooltip-body">${contentHTML}</div>`;
        return out;
      },
      offset: [0, 8],
      placement: 'top',
      // when tooltip is shown, ensure image is decoded/painted and visible
      onShow(instance){
        try {
          const img = instance.popper.querySelector('.tooltip-img');
          if(img){
            // If src was set and image not complete, try decode; if decode fails, ignore
            if(!img.complete){
              // start load in case something prevented it earlier
              img.src = img.getAttribute('src');
            }
            // Force a reflow and try to decode so the browser paints it immediately
            void img.offsetWidth;
            if(img.decode) {
              img.decode().catch(()=>{ /* ignore decode errors */ });
            }
          }
        } catch(e){
          // ignore any tippy/popper timing errors
        }
      }
    });
  }

  /* TIPPY for nav buttons */
  function refreshTippyContents(){
    if(!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => {
      if(!btn) return;
      try{ if(btn._tippy) btn._tippy.destroy(); }catch(e){}
    });

    if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8], appendTo: () => document.body });
  }

  /* Chapters aside slide-in/out behavior */
  let chaptersOpen = false;
  const EDGE_TRIGGER_PX = 12;
  function openChapters(){ if(chaptersOpen) return; chaptersOpen = true; document.body.classList.add('chapters-open'); }
  function closeChapters(){ if(!chaptersOpen) return; chaptersOpen = false; document.body.classList.remove('chapters-open'); }

  document.addEventListener('mousemove', (e) => {
    if(window.innerWidth <= 700) return;
    if(e.clientX <= EDGE_TRIGGER_PX) openChapters();
  });

  if(chaptersAside){
    chaptersAside.addEventListener('mouseenter', openChapters);
    chaptersAside.addEventListener('mouseleave', (ev) => { if(ev.clientX <= EDGE_TRIGGER_PX) return; closeChapters(); });
  }

  document.addEventListener('click', (e) => {
    if(!chaptersOpen) return;
    if(chaptersAside && chaptersAside.contains(e.target)) return;
    if(e.clientX <= EDGE_TRIGGER_PX) return;
    closeChapters();
  });

  /* Top nav positioning & visibility logic */
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

  function showTopNav(){ if(bottomNavIsVisible()){ hideTopNav(); return; } topNav.classList.add('visible-top'); topNav.setAttribute('aria-hidden', 'false'); }
  function hideTopNav(){ if(hideDelayTimer){ clearTimeout(hideDelayTimer); hideDelayTimer = null; } topNav.classList.remove('visible-top'); topNav.setAttribute('aria-hidden', 'true'); }
  function scheduleHideTopNavWithDelay(){ if(hideDelayTimer) return; hideDelayTimer = setTimeout(() => { if(!bottomNavIsVisible()) hideTopNav(); hideDelayTimer = null; }, HIDE_DELAY_MS); }

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

  window.addEventListener('resize', () => { positionTopNav(); onScrollCheck(); });

  const observer = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(en => en.isIntersecting);
    if(anyVisible) { hideTopNav(); }
  }, { root: null, threshold: 0.01 });
  if(bottomNav) observer.observe(bottomNav);

  function initialTopNavSetup(){
    positionTopNav();
    if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNav(); else hideTopNav();
  }
  setTimeout(initialTopNavSetup, 40);

  /* Image viewer */
  if(!document.getElementById('image-overlay')){
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

  function openImageViewer(src, alt = ''){
    overlayImg.src = src;
    overlayImg.alt = alt || '';
    overlay.classList.add('visible');
    isZoomed = false;
    imgPos = { x: 0, y: 0 };
    overlayImg.style.transform = `translate(0px, 0px) scale(1)`;
    overlayImg.classList.remove('zoomed');
    overlay.style.cursor = 'default';
    document.body.style.overflow = 'hidden';
  }

  function closeImageViewer(){
    overlay.classList.remove('visible');
    overlayImg.src = '';
    isZoomed = false;
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

  overlayImg.addEventListener('click', (ev) => {
    if(suppressClick){ suppressClick = false; return; }
    isZoomed = !isZoomed;
    if(!isZoomed) imgPos = { x: 0, y: 0 };
    applyImageTransform();
  });

  overlayImg.addEventListener('mousedown', (ev) => {
    if(!isZoomed) return;
    ev.preventDefault();
    pointerDown = true;
    dragMoved = false;
    pointerStart = { x: ev.clientX, y: ev.clientY };
    overlayImg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (ev) => {
    if(!pointerDown || !isZoomed) return;
    const dx = ev.clientX - pointerStart.x;
    const dy = ev.clientY - pointerStart.y;
    if(!dragMoved && (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD)){
      dragMoved = true;
    }
    if(dragMoved){
      pointerStart = { x: ev.clientX, y: ev.clientY };
      imgPos.x += dx;
      imgPos.y += dy;
      applyImageTransform();
    }
  });

  window.addEventListener('mouseup', (ev) => {
    if(pointerDown && dragMoved){
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    pointerDown = false;
    overlayImg.style.cursor = isZoomed ? 'grab' : 'zoom-in';
  });

  overlay.addEventListener('click', (ev) => { if(ev.target === overlay) closeImageViewer(); });
  window.addEventListener('keydown', (ev) => { if(ev.key === 'Escape' && overlay.classList.contains('visible')) closeImageViewer(); });

  function bindImagesToViewer(){
    const imgs = chapterBodyEl.querySelectorAll('img');
    imgs.forEach(img => {
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
