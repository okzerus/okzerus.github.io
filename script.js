// script.js - consolidated: chapter loader, theme, slide-out chapters, nav, robust tippy tooltips (top images), image viewer

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
  let lastChapterFile = null; // e.g. "chapters/01.md" - used to resolve relative data-img paths

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

  /* Load chapters.json */
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

      const first = findFirstDoneIndex();
      if(first !== -1) goToChapter(first);
      else {
        chapterBodyEl.textContent = 'В репозитории нет доступных (done) глав.';
        updateNavButtons();
      }
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message;
      console.error('loadChapters error:', err);
      [bottomPrev, bottomNext, topPrev, topNext].forEach(b => { if(b) b.disabled = true; });
    }
  }

  /* Load a chapter file and remember its path for resolving tooltip images */
  async function loadChapter(filename, title){
    chapterTitleEl.textContent = title || '';
    chapterBodyEl.textContent = 'Загрузка главы...';
    try{
      const res = await fetch('chapters/' + filename, {cache: 'no-store'});
      if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + filename);
      const md = await res.text();
      // record last chapter file path relative to site root: 'chapters/01.md'
      lastChapterFile = 'chapters/' + filename;
      const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: библиотека marked не загружена.</p>';
      chapterBodyEl.innerHTML = html;

      // Initialize glossary tippies (image-capable)
      initGlossTippy();

      // Re-bind images inside chapter to viewer
      bindImagesToViewer();

      updateNavButtons();
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
      console.error('loadChapter error:', err);
    }
  }

  /* -------------------------
     Robust image resolver helper
     Tries candidate URLs in order and resolves to the first that loads.
     Returns Promise<string|null>
  --------------------------*/
  function testImageUrl(url, timeout = 3000){
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const onLoad = () => { if(done) return; done = true; cleanup(); resolve(url); };
      const onErr = () => { if(done) return; done = true; cleanup(); resolve(null); };
      const cleanup = () => { img.onload = img.onerror = null; clearTimeout(timer); };
      img.onload = onLoad;
      img.onerror = onErr;
      // start loading
      img.src = url;
      const timer = setTimeout(() => { if(done) return; done = true; cleanup(); resolve(null); }, timeout);
    });
  }

  async function resolveTooltipImage(srcCandidate){
    if(!srcCandidate) return null;
    // If absolute (http or starting with /) try directly first
    if(/^https?:\/\//i.test(srcCandidate) || srcCandidate.startsWith('/')) {
      const ok = await testImageUrl(srcCandidate);
      if(ok) return srcCandidate;
      // if fails, continue to other candidates
    }

    // Build a set of candidates:
    // 1) as-given relative to page (e.g., "images/foo.png")
    // 2) relative to the chapter file directory (chapters/ + dirname(lastChapterFile) + '/' + src)
    // 3) parent-of-chapter dir + '/' + src (../images/foo.png)
    // 4) root-prefixed ("/" + src)
    const candidates = [];

    // raw
    candidates.push(srcCandidate);

    if(lastChapterFile){
      const parts = lastChapterFile.split('/');
      parts.pop(); // remove filename -> get directory (e.g. 'chapters')
      const dir = parts.join('/');
      if(dir) candidates.push(dir + '/' + srcCandidate);
      // parent dir
      const parentParts = parts.slice(0, -1);
      if(parentParts.length >= 0){
        const parentDir = parentParts.join('/');
        if(parentDir) candidates.push(parentDir + '/' + srcCandidate);
        else candidates.push('../' + srcCandidate); // fallback
      } else {
        candidates.push('../' + srcCandidate);
      }
    }

    // root-prefixed
    candidates.push('/' + srcCandidate);

    // ensure uniqueness while preserving order
    const seen = new Set();
    const uniqueCandidates = candidates.filter(s => {
      if(!s) return false;
      if(seen.has(s)) return false;
      seen.add(s);
      return true;
    });

    // test candidates in sequence and return first that works
    for(const c of uniqueCandidates){
      const ok = await testImageUrl(c);
      if(ok) return c;
    }
    return null;
  }

  /* -------------------------
     Tippy init for .gloss elements (image-on-top support)
     Uses Promise-based content builder so image resolution can happen async.
  --------------------------*/
  function initGlossTippy(){
    if(!window.tippy) return;

    // destroy any existing gloss tippies to avoid duplicates
    document.querySelectorAll('.gloss').forEach(el => {
      try{ if(el._tippy) el._tippy.destroy(); }catch(e){}
    });

    tippy('.gloss', {
      allowHTML: true,
      interactive: true,
      delay: [100, 120],
      maxWidth: 360,
      placement: 'top',
      offset: [0, 8],
      content(reference){
        // return a Promise that resolves to a node (tippy supports that)
        return (async () => {
          // get text/HTML content
          let contentHTML = reference.getAttribute('data-tippy-content') || reference.getAttribute('data-tip') || reference.getAttribute('title') || reference.innerHTML || '';
          if(reference.getAttribute('title')) reference.removeAttribute('title');

          const dataImg = reference.getAttribute('data-img');
          const imgAlt = reference.getAttribute('data-img-alt') || '';

          const wrapper = document.createElement('div');

          if(dataImg){
            const resolved = await resolveTooltipImage(dataImg);
            if(resolved){
              const img = document.createElement('img');
              img.className = 'tooltip-img';
              img.src = resolved;
              img.alt = imgAlt;
              img.loading = 'lazy';
              wrapper.appendChild(img);
            }
          }

          const contentDiv = document.createElement('div');
          contentDiv.className = 'tooltip-body';
          contentDiv.innerHTML = contentHTML;
          wrapper.appendChild(contentDiv);

          return wrapper;
        })();
      }
    });
  }

  /* Tippy tooltips for nav buttons */
  function refreshNavTippies(){
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

  /* Chapters aside slide-in/out behavior (unchanged) */
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

  /* Top nav positioning & visibility (unchanged) */
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

  /* --- Image viewer binding --- */
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

  /* Start */
  loadChapters();
  updateNavButtons();
  setTimeout(() => {
    positionTopNav();
    if(window.scrollY <= 10 && !bottomNavIsVisible()){
      showTopNav();
    }
  }, 120);

});
