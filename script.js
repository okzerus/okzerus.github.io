// script.js - consolidated with:
// - chapter + scroll persistence (via localStorage & URL hash)
// - tooltip preloading using fetch -> blob -> objectURL (cached so hover is instant)
// - tooltip banner resizing to avoid going off-screen (auto adjust height, allow scrolling)
// - all previously implemented features kept (done flag, slide-out chapters, top/bottom nav, image viewer)

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

  // state
  let chapters = [];
  let currentIndex = -1;
  let lastChapterFile = null; // 'chapters/01.md'

  // caches for tooltip images
  // resolvedUrlCache: data-img string -> resolved absolute URL or null
  const resolvedUrlCache = new Map();
  // preloadedBlobCache: resolved absolute URL -> { objUrl: string, size?: number }
  const preloadedBlobCache = new Map();

  /* THEME */
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
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }
  (function initTheme(){
    const saved = localStorage.getItem('site-theme');
    applyTheme(saved === 'light' ? 'light' : 'dark');
  })();
  if(themeToggle) themeToggle.addEventListener('click', toggleTheme);

  /* done flag helpers */
  function isDoneEntry(entry){ if(!entry) return false; return entry.done !== false; }
  function findPrevDoneIndex(fromIndex){
    for(let i = (fromIndex === undefined ? currentIndex - 1 : fromIndex); i >= 0; i--) {
      if(isDoneEntry(chapters[i])) return i;
    }
    return -1;
  }
  function findNextDoneIndex(fromIndex){
    for(let i = (fromIndex === undefined ? currentIndex + 1 : fromIndex); i < chapters.length; i++) {
      if(isDoneEntry(chapters[i])) return i;
    }
    return -1;
  }
  function findFirstDoneIndex(){ return findNextDoneIndex(0); }

  /* NAV BUTTONS */
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

    refreshNavTippies();
  }

  function goToChapter(index){
    if(!chapters || index < 0 || index >= chapters.length) return;
    if(!isDoneEntry(chapters[index])) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    window.scrollTo({ top: 0, behavior: 'auto' });
    closeChapters();
    // persist chosen chapter immediately
    persistLastChapter(c.file);
    updateHashForFile(c.file);
  }

  if(bottomPrev) bottomPrev.addEventListener('click', ()=>{ const i = Number(bottomPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(bottomNext) bottomNext.addEventListener('click', ()=>{ const i = Number(bottomNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topPrev) topPrev.addEventListener('click', ()=>{ const i = Number(topPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topNext) topNext.addEventListener('click', ()=>{ const i = Number(topNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });

  document.addEventListener('keydown', (e)=>{
    const active = document.activeElement;
    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if(e.key === 'ArrowLeft'){ const prev = findPrevDoneIndex(); if(prev !== -1) goToChapter(prev); }
    if(e.key === 'ArrowRight'){ const next = findNextDoneIndex(); if(next !== -1) goToChapter(next); }
  });

  /* PERSISTENCE: last chapter & per-chapter scroll */
  function persistLastChapter(filename){
    try{ localStorage.setItem('last-chapter', filename); }catch(e){}
  }
  function persistScrollForFile(filename, y){
    if(!filename) return;
    try{ localStorage.setItem('scroll:' + filename, String(Math.max(0, Math.floor(y || 0)))); }catch(e){}
  }
  function getSavedScrollForFile(filename){
    try{
      const v = localStorage.getItem('scroll:' + filename);
      return v ? Number(v) : 0;
    }catch(e){ return 0; }
  }

  // update URL hash to a short token based on filename (remove extension)
  function updateHashForFile(filename){
    try{
      const base = filename.replace(/\.[^/.]+$/, '');
      history.replaceState(null, '', '#' + encodeURIComponent(base));
    }catch(e){}
  }

  // compute filename requested by hash if any
  function filenameFromHashOrStorage(){
    const h = (location.hash || '').replace(/^#/, '').trim();
    if(h){
      // try to match a filename that starts with this token (case-sensitive)
      // e.g. hash '#06b' should match '06b.md' or '06b.md' in chapters.json
      // We will look for exact base match later after chapters.json loads.
      return decodeURIComponent(h);
    }
    const last = localStorage.getItem('last-chapter') || null;
    return last;
  }

  /* LOAD CHAPTER LIST */
  async function loadChapters(){
    chapterBodyEl.textContent = 'Загрузка...';
    try{
      const res = await fetch('chapters.json', {cache:'no-store'});
      if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching chapters.json');
      const data = await res.json();
      if(!Array.isArray(data)) throw new Error('chapters.json is not an array');
      chapters = data;
      chaptersListEl.innerHTML = '';

      chapters.forEach((c,i)=>{
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

      // choose initial chapter: prefer hash -> localStorage -> first done
      const requestedBase = filenameFromHashOrStorage(); // may be '01' or 'chapters/01.md' or '06b'
      let initialIndex = -1;
      if(requestedBase){
        // if requestedBase looks like a full filename with slash, try to match exact file
        chapters.forEach((c,idx)=>{
          if(c.file === requestedBase || c.file === requestedBase + '.md' || c.file.endsWith('/' + requestedBase) ) initialIndex = initialIndex === -1 ? idx : initialIndex;
        });
        if(initialIndex === -1){
          // try matching base name (filename without ext)
          chapters.forEach((c,idx)=>{
            const base = c.file.replace(/\.[^/.]+$/, '');
            if(base === requestedBase) initialIndex = initialIndex === -1 ? idx : initialIndex;
          });
        }
      }
      if(initialIndex === -1){
        initialIndex = findFirstDoneIndex();
      }
      if(initialIndex !== -1) {
        goToChapter(initialIndex);
      } else {
        chapterBodyEl.textContent = 'В репозитории нет доступных (done) глав.';
        updateNavButtons();
      }
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message;
      console.error('loadChapters error:', err);
      if(bottomPrev) bottomPrev.disabled = true;
      if(bottomNext) bottomNext.disabled = true;
      if(topPrev) topPrev.disabled = true;
      if(topNext) topNext.disabled = true;
    }
  }

  /* LOAD CHAPTER CONTENT */
  async function loadChapter(filename, title){
    chapterTitleEl.textContent = title || '';
    chapterBodyEl.textContent = 'Загрузка главы...';
    try{
      const res = await fetch('chapters/' + filename, {cache:'no-store'});
      if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + filename);
      const md = await res.text();
      lastChapterFile = 'chapters/' + filename;
      const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: библиотека marked не загружена.</p>';
      chapterBodyEl.innerHTML = html;

      // preload tooltip images (starts fetch->blob preloads)
      preloadTooltipImages();

      // init tooltips (uses cached blob URLs where available)
      initGlossTippy();

      // bind in-chapter images to viewer
      bindImagesToViewer();

      updateNavButtons();

      // restore scroll for this chapter (if saved)
      const savedY = getSavedScrollForFile(filename);
      // Wait until images in the chapter finish loading (so height is stable)
      await waitForImagesToLoad(chapterBodyEl);
      // apply saved scroll (only if > 0)
      if(typeof savedY === 'number' && savedY > 0){
        window.scrollTo({ top: savedY, behavior: 'auto' });
      } else {
        // if there was no saved scroll and we have a hash that explicitly requested this file,
        // try to use fragment anchor inside content (if present)
        const hash = (location.hash || '').replace(/^#/, '').trim();
        if(hash && hash === filename.replace(/\.[^/.]+$/,'')){
          // no action — we already scrolled to top earlier; anchor handling not implemented
        }
      }
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
      console.error('loadChapter error:', err);
    }
  }

  /* helper: wait for images inside given container to load */
  function waitForImagesToLoad(container){
    const imgs = container.querySelectorAll('img');
    if(!imgs || imgs.length === 0) return Promise.resolve();
    return Promise.all(Array.from(imgs).map(img => {
      if(img.complete) return Promise.resolve();
      return new Promise(res => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      });
    }));
  }

  /* ---------------- IMAGE RESOLVE & PRELOAD (fetch->blob->objectURL) ---------------- */

  function testImageUrl(url, timeout = 4000){
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const onLoad = () => { if(done) return; done = true; cleanup(); resolve(true); };
      const onErr  = () => { if(done) return; done = true; cleanup(); resolve(false); };
      const cleanup = () => { img.onload = img.onerror = null; clearTimeout(timer); };
      img.onload = onLoad; img.onerror = onErr;
      img.src = url;
      const timer = setTimeout(() => { if(done) return; done = true; cleanup(); resolve(false); }, timeout);
    });
  }

  // resolve a 'data-img' string to an absolute URL (tries several base candidates)
  async function resolveTooltipImage(srcCandidate){
    if(!srcCandidate) return null;
    if(resolvedUrlCache.has(srcCandidate)) return resolvedUrlCache.get(srcCandidate);

    // try as-is absolute or root
    if(/^https?:\/\//i.test(srcCandidate) || srcCandidate.startsWith('/')){
      try{
        if(await testImageUrl(srcCandidate)){ resolvedUrlCache.set(srcCandidate, srcCandidate); return srcCandidate; }
      }catch(e){}
    }

    // candidate bases
    const bases = [];
    bases.push(window.location.href);
    bases.push(window.location.origin + window.location.pathname);
    if(lastChapterFile){
      bases.push(window.location.origin + '/' + lastChapterFile);
      const parts = lastChapterFile.split('/');
      parts.pop();
      const parent = parts.join('/');
      if(parent) bases.push(window.location.origin + '/' + parent + '/');
    }
    bases.push(window.location.origin + '/');

    // build unique list
    const candidates = [];
    for(const base of bases){
      try{ const u = new URL(srcCandidate, base); candidates.push(u.href); }catch(e){}
    }
    const seen = new Set();
    const unique = candidates.filter(c => { if(seen.has(c)) return false; seen.add(c); return true; });

    for(const u of unique){
      try{
        if(await testImageUrl(u)){ resolvedUrlCache.set(srcCandidate, u); return u; }
      }catch(e){}
    }
    resolvedUrlCache.set(srcCandidate, null);
    return null;
  }

  // preload tooltip images by fetching them, converting to blob and creating object URLs
  async function preloadTooltipImages(){
    if(!chapterBodyEl) return;
    const glossEls = Array.from(chapterBodyEl.querySelectorAll('.gloss'));
    if(!glossEls.length) return;

    for(const el of glossEls){
      const dataImg = el.getAttribute('data-img');
      if(!dataImg) continue;
      try{
        // skip if previously decided missing
        if(resolvedUrlCache.has(dataImg) && resolvedUrlCache.get(dataImg) === null) continue;

        const resolved = await resolveTooltipImage(dataImg);
        if(!resolved) continue;

        // if we've preloaded already, skip
        if(preloadedBlobCache.has(resolved)) continue;

        // fetch resource as blob (use browser cache when possible)
        try{
          console.debug('tippy-img: fetching blob for', resolved);
          const r = await fetch(resolved, { cache: 'force-cache' });
          if(!r.ok) { console.warn('tippy-img: fetch failed', resolved, r.status); continue; }
          const blob = await r.blob();
          const objUrl = URL.createObjectURL(blob);
          preloadedBlobCache.set(resolved, { objUrl, size: blob.size || 0 });
          console.debug('tippy-img: blob ready', resolved, objUrl);
        }catch(err){
          console.warn('tippy-img: preload fetch error', resolved, err);
        }
      }catch(err){
        console.debug('tippy-img: preload error for', dataImg, err);
      }
    }
  }

  /* ---------------- TIPPY: create banner tooltips using preloaded blob object URLs where available ---------------- */
  function initGlossTippy(){
    if(!window.tippy) return;
    // destroy existing
    document.querySelectorAll('.gloss').forEach(el => { try{ if(el._tippy) el._tippy.destroy(); }catch(e){} });

    tippy('.gloss', {
      allowHTML: true,
      interactive: true,
      delay: [60, 80],
      maxWidth: 520,
      placement: 'top',
      offset: [0,8],
      appendTo: () => document.body,
      popperOptions: {
        strategy: 'fixed',
        modifiers: [
          { name: 'preventOverflow', options: { padding: 8, boundary: document.body } },
          { name: 'flip', options: { fallbackPlacements: ['top','bottom','right','left'] } }
        ]
      },
      content: 'Loading...',
      onShow: async (instance) => {
        const ref = instance.reference;
        let contentHTML = ref.getAttribute('data-tippy-content') || ref.getAttribute('data-tip') || ref.getAttribute('title') || ref.innerHTML || '';
        if(ref.getAttribute('title')) ref.removeAttribute('title');

        const dataImg = ref.getAttribute('data-img');
        const imgAlt = ref.getAttribute('data-img-alt') || '';

        const wrapper = document.createElement('div');

        // compute desired banner height, but adjust to available viewport
        const baseDesired = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tooltip-image-height')) || 200;
        let desiredHeight = baseDesired;

        // measure space above and below the reference element
        const rect = ref.getBoundingClientRect();
        const spaceAbove = rect.top - 8;
        const spaceBelow = window.innerHeight - rect.bottom - 8;

        // pick placement preference: top if there's more space above, else bottom
        let preferTop = spaceAbove >= spaceBelow;

        // pick maximum allowed height
        const usable = Math.max(spaceAbove, spaceBelow) - 40; // keep 40px margin for text/body
        if(usable > 80){
          desiredHeight = Math.min(baseDesired, Math.floor(usable * 0.9));
        } else {
          desiredHeight = Math.min(baseDesired, Math.max(80, Math.floor(Math.min(spaceAbove, spaceBelow) * 0.9)));
        }

        // attempt to resolve & use image
        if(dataImg){
          let resolved = null;
          if(resolvedUrlCache.has(dataImg)) resolved = resolvedUrlCache.get(dataImg);
          else resolved = await resolveTooltipImage(dataImg);

          if(resolved){
            // prefer preloaded blob object URL if available
            const blobEntry = preloadedBlobCache.get(resolved);
            const srcToUse = blobEntry ? blobEntry.objUrl : resolved;

            const img = document.createElement('img');
            img.className = 'tooltip-img';
            img.src = srcToUse;
            img.alt = imgAlt;
            img.loading = 'eager';
            img.style.height = desiredHeight + 'px';
            img.style.objectFit = 'cover';
            img.style.display = 'block';
            img.style.cursor = 'pointer';
            // clicking opens lightbox and hides tooltip
            img.addEventListener('click', (ev) => {
              ev.stopPropagation();
              try{ openImageViewer(resolved, imgAlt); }catch(e){ console.error(e); }
              try{ instance.hide(); }catch(e){}
            });
            // when image loads, ask popper to update
            img.addEventListener('load', () => {
              try{ if(instance.popperInstance && typeof instance.popperInstance.update === 'function') instance.popperInstance.update(); else if(typeof instance.update === 'function') instance.update(); }catch(e){}
            });

            wrapper.appendChild(img);
          }
        }

        // textual body
        const contentDiv = document.createElement('div');
        contentDiv.className = 'tooltip-body';
        contentDiv.innerHTML = contentHTML;
        // allow the textual body to scroll if huge
        contentDiv.style.maxHeight = '40vh';
        contentDiv.style.overflow = 'auto';
        wrapper.appendChild(contentDiv);

        try{ instance.setContent(wrapper); }catch(e){ instance.setContent(wrapper.outerHTML); }
      }
    });
  }

  /* nav tippies */
  function refreshNavTippies(){
    if(!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if(!btn) return; try{ if(btn._tippy) btn._tippy.destroy(); }catch(e){} });
    if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8], appendTo: () => document.body });
  }

  /* chapters aside slide-in/out */
  let chaptersOpen = false;
  const EDGE_TRIGGER_PX = 12;
  function openChapters(){ if(chaptersOpen) return; chaptersOpen = true; document.body.classList.add('chapters-open'); }
  function closeChapters(){ if(!chaptersOpen) return; chaptersOpen = false; document.body.classList.remove('chapters-open'); }

  document.addEventListener('mousemove', (e) => { if(window.innerWidth <= 700) return; if(e.clientX <= EDGE_TRIGGER_PX) openChapters(); });
  if(chaptersAside){
    chaptersAside.addEventListener('mouseenter', openChapters);
    chaptersAside.addEventListener('mouseleave', (ev) => { if(ev.clientX <= EDGE_TRIGGER_PX) return; closeChapters(); });
  }
  document.addEventListener('click', (e) => { if(!chaptersOpen) return; if(chaptersAside && chaptersAside.contains(e.target)) return; if(e.clientX <= EDGE_TRIGGER_PX) return; closeChapters(); });

  /* top nav positioning & visibility */
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

  function bottomNavIsVisible(){ if(!bottomNav) return false; const r = bottomNav.getBoundingClientRect(); return (r.top < window.innerHeight) && (r.bottom > 0); }
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
    requestAnimationFrame(()=>{ onScrollCheck(); scheduled=false; });
  }, { passive:true });

  window.addEventListener('resize', () => { positionTopNav(); onScrollCheck(); });

  const observer = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(en => en.isIntersecting);
    if(anyVisible) hideTopNav();
  }, { root:null, threshold:0.01 });

  if(bottomNav) observer.observe(bottomNav);

  function initialTopNavSetup(){ positionTopNav(); if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNav(); else hideTopNav(); }
  setTimeout(initialTopNavSetup, 40);

  /* IMAGE VIEWER */
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
  let pointerStart = { x:0, y:0 };
  let imgPos = { x:0, y:0 };
  let dragMoved = false;
  let suppressClick = false;
  const DRAG_THRESHOLD = 4;

  function openImageViewer(src, alt = ''){
    overlayImg.src = src;
    overlayImg.alt = alt || '';
    // defensive inline sizing
    const marginPx = 40;
    overlayImg.style.maxWidth = `calc(100vw - ${marginPx}px)`;
    overlayImg.style.maxHeight = `calc(100vh - ${Math.round(marginPx * 1.5)}px)`;

    overlay.classList.add('visible');
    isZoomed = false;
    imgPos = { x:0, y:0 };
    overlayImg.style.transform = `translate(0px, 0px) scale(1)`;
    overlayImg.classList.remove('zoomed');
    overlay.style.cursor = 'default';
    document.body.style.overflow = 'hidden';

    const viewer = overlay.querySelector('.viewer');
    if(viewer){ viewer.scrollTop = 0; viewer.scrollLeft = 0; }
  }

  function closeImageViewer(){
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

  function applyImageTransform(){
    const scale = isZoomed ? 2 : 1;
    overlayImg.style.transform = `translate(${imgPos.x}px, ${imgPos.y}px) scale(${scale})`;
    if(isZoomed) overlayImg.classList.add('zoomed'); else overlayImg.classList.remove('zoomed');
  }

  overlayImg.addEventListener('click', (ev) => {
    if(suppressClick){ suppressClick = false; return; }
    isZoomed = !isZoomed;
    if(!isZoomed) imgPos = { x:0, y:0 };
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
    if(!dragMoved && (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD)) dragMoved = true;
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
      setTimeout(()=>{ suppressClick = false; }, 0);
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
      clone.style.cursor = 'pointer';
      img.parentNode.replaceChild(clone, img);
      clone.addEventListener('click', (e) => {
        const src = clone.getAttribute('src') || clone.getAttribute('data-src') || '';
        if(!src) return;
        openImageViewer(src, clone.getAttribute('alt') || '');
      });
    });
  }

  /* ---------------- SAVE SCROLL POSITION while reading (throttled) ---------------- */
  let scrollSaveTimer = null;
  function scheduleSaveScroll(){
    if(scrollSaveTimer) clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(()=> {
      scrollSaveTimer = null;
      if(currentIndex >= 0 && chapters[currentIndex] && chapters[currentIndex].file){
        persistScrollForFile(chapters[currentIndex].file, window.scrollY);
      }
    }, 250); // throttle every 250ms
  }
  window.addEventListener('scroll', scheduleSaveScroll, { passive:true });
  window.addEventListener('beforeunload', ()=> {
    if(currentIndex >= 0 && chapters[currentIndex] && chapters[currentIndex].file){
      persistScrollForFile(chapters[currentIndex].file, window.scrollY);
      persistLastChapter(chapters[currentIndex].file);
    }
  });

  /* ---------------- START ---------------- */
  loadChapters();
  updateNavButtons();
  setTimeout(()=>{ positionTopNav(); if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNav(); }, 120);

});
