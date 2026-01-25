// script.js - enhanced center layout + centered top nav behavior + slide-back upon chapter click
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
    themeToggle.textContent = (theme === 'dark') ? '☼' : '☾';
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
    // refresh tooltip content if present
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
    // close chapters list when user navigates via the chapter list (satisfies request #4)
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
      // Init tippy on glossary spans (if loaded)
      if(window.tippy) {
        tippy('.gloss', { allowHTML: true, interactive: true, delay: [100, 100] });
      }
      updateNavButtons();
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
     Show top nav when user scrolls UP or is at top; hide when user scrolls DOWN.
     No idle auto-hide — it stays visible after an upward scroll until user scrolls down.
  */
  let lastScrollY = window.scrollY;

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

  function onScrollCheck(){
    const curY = window.scrollY;
    const scrollingUp = curY < lastScrollY;
    const atTop = curY <= 10;

    if(bottomNavIsVisible()){
      hideTopNav();
    } else if(atTop || scrollingUp){
      showTopNav();
    } else {
      // scrolling down
      hideTopNav();
    }

    lastScrollY = curY;
  }

  let scheduled = false;
  window.addEventListener('scroll', () => {
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{ onScrollCheck(); scheduled = false; });
  }, { passive: true });

  window.addEventListener('resize', () => {
    onScrollCheck();
  });

  // Intersection observer to hide top nav when bottom nav intersects viewport
  const observer = new IntersectionObserver((entries) => {
    const anyVisible = entries.some(en => en.isIntersecting);
    if(anyVisible) hideTopNav();
  }, { root: null, threshold: 0.01 });

  if(bottomNav) observer.observe(bottomNav);

  /* Start: load chapters list */
  loadChapters();

  // initial update
  updateNavButtons();
  onScrollCheck();
});
