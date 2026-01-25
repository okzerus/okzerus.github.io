// script.js - enhanced chapter UI: slide-out chapters list, ellipsis, top/bottom nav
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

    // store target indices & titles as data attributes for tooltips & click handlers
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
  }

  // Click handlers
  function goToChapter(index){
    if(!chapters || index < 0 || index >= chapters.length) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    // update tippy contents if present
    refreshTippyContents();
    // if chapter is long, scroll to top when navigating
    window.scrollTo({ top: 0 });
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
        // ellipsis styling is handled in CSS; keep anchor as block
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
      // disable nav buttons
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
      // After loading a chapter, update nav button titles & tippy
      updateNavButtons();
      refreshTippyContents();
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message + '\nПроверьте, что файл chapters/' + filename + ' существует.';
      console.error('loadChapter error:', err);
    }
  }

  /* TIPPY tooltips for nav buttons */
  let tooltipInstances = [];
  function refreshTippyContents(){
    // destroy any existing nav tippies to avoid duplicates
    tooltipInstances.forEach(inst => { try{ inst.destroy(); }catch(e){} });
    tooltipInstances = [];

    if(!window.tippy) return;

    // bottom buttons: tooltip above the button
    if(bottomPrev) tooltipInstances.push( tippy(bottomPrev, {
      content: () => bottomPrev.dataset.title || '',
      placement: 'top',
      delay: [80, 40],
      offset: [0, 8],
      allowHTML: false,
    }) );
    if(bottomNext) tooltipInstances.push( tippy(bottomNext, {
      content: () => bottomNext.dataset.title || '',
      placement: 'top',
      delay: [80, 40],
      offset: [0, 8],
      allowHTML: false,
    }) );

    // top buttons: tooltip below the button
    if(topPrev) tooltipInstances.push( tippy(topPrev, {
      content: () => topPrev.dataset.title || '',
      placement: 'bottom',
      delay: [80, 40],
      offset: [0, 8],
      allowHTML: false,
    }) );
    if(topNext) tooltipInstances.push( tippy(topNext, {
      content: () => topNext.dataset.title || '',
      placement: 'bottom',
      delay: [80, 40],
      offset: [0, 8],
      allowHTML: false,
    }) );
  }

  /* Chapters aside slide-in/out behavior when mouse near left edge */
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

  // Open when mouse near left edge
  document.addEventListener('mousemove', (e) => {
    // do not trigger on narrow screens (mobile)
    if(window.innerWidth <= 700) return;
    if(e.clientX <= EDGE_TRIGGER_PX) openChapters();
  });

  // Keep open while hovering the aside; close when leaving aside
  if(chaptersAside){
    chaptersAside.addEventListener('mouseenter', openChapters);
    chaptersAside.addEventListener('mouseleave', (ev) => {
      // If mouse still at edge, keep open else close
      if(ev.clientX <= EDGE_TRIGGER_PX) return;
      closeChapters();
    });
  }

  // Also close chapters if user clicks outside and mouse is far from edge (optional usability)
  document.addEventListener('click', (e) => {
    if(!chaptersOpen) return;
    // If click is inside aside, do nothing
    if(chaptersAside && chaptersAside.contains(e.target)) return;
    // If click was on the small handle area (edge), keep open
    if(e.clientX <= EDGE_TRIGGER_PX) return;
    closeChapters();
  });

  /* Scroll behaviour for top nav: appear when scrolling up, disappear when scrolling down or idle.
     Top nav must remain hidden if bottom nav is visible on screen. */
  let lastScrollY = window.scrollY;
  let scrollTimer = null;
  const IDLE_TIMEOUT = 1100; // ms to consider "not scrolling" -> hide top nav

  function bottomNavIsVisible(){
    if(!bottomNav) return false;
    const r = bottomNav.getBoundingClientRect();
    return (r.top < window.innerHeight) && (r.bottom > 0);
  }

  function showTopNav(){
    // don't show if bottom nav is visible
    if(bottomNavIsVisible()) {
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

    // if bottom nav visible, ensure top nav is hidden
    if(bottomNavIsVisible()){
      hideTopNav();
    } else if(atTop) {
      // always show when at the very top of the page
      showTopNav();
    } else if(scrollingUp) {
      showTopNav();
    } else {
      // scrolling down -> hide top nav
      hideTopNav();
    }

    lastScrollY = curY;

    // idle timer: hide top nav after IDLE_TIMEOUT ms of no scrolling
    if(scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      hideTopNav();
    }, IDLE_TIMEOUT);
  }

  // Attach scroll listener with requestAnimationFrame throttle
  let scheduled = false;
  window.addEventListener('scroll', () => {
    if(scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{ onScrollCheck(); scheduled = false; });
  }, { passive: true });

  // Also check on resize (bottomNav visibility can change)
  window.addEventListener('resize', () => {
    // immediate check for bottom/top nav visibility
    onScrollCheck();
  });

  // When bottom nav enters/leaves viewport due to content load or resize, we should update top nav visibility
  const observer = new IntersectionObserver((entries) => {
    // If bottom nav intersects viewport, hide top nav
    const anyVisible = entries.some(en => en.isIntersecting);
    if(anyVisible) hideTopNav();
  }, { root: null, threshold: 0.01 });

  if(bottomNav) observer.observe(bottomNav);

  /* Ensure top/bottom tooltips are created when the page loads and whenever nav data changes */
  refreshTippyContents();

  /* Helper to update tippy tooltips content live when chapters change */
  function updateTooltipTextForButton(btn){
    const inst = (btn && btn._tippy) ? btn._tippy : null;
    if(inst && btn.dataset && btn.dataset.title !== undefined){
      inst.setContent(btn.dataset.title || '');
    }
  }

  function refreshAllTooltipTexts(){
    [bottomPrev, bottomNext, topPrev, topNext].forEach(updateTooltipTextForButton);
  }

  function refreshTippyContentsDeferred(){
    // small delay to ensure DOM updated before initializing tooltips
    setTimeout(() => { refreshTippyContents(); }, 10);
  }

  // update tippy contents helper
  function refreshTippyContents(){
    // re-create tooltip instances
    if(window.tippy) {
      // destroy existing nav tippies stored in button._tippy by tippy library if necessary
      [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => {
        if(!btn) return;
        try{
          if(btn._tippy) btn._tippy.destroy();
        }catch(e){}
      });

      // bottom: placement top
      if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8] });
      if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8] });

      // top: placement bottom
      if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8] });
      if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8] });
    }
  }

  /* Start: load chapters list */
  loadChapters();

  // initial nav button update
  updateNavButtons();

  // ensure top nav visibility state is correct at load
  onScrollCheck();
});
