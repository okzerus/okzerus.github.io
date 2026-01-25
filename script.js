// script.js - DOM-ready loader, defensive, theme toggle, tippy init, prev/next nav,
// plus chapters show/hide toggle with smooth transitions and persisting state.

document.addEventListener('DOMContentLoaded', () => {
  const chaptersListEl = document.getElementById('chapters');
  const chapterBodyEl = document.getElementById('chapter-body');
  const chapterTitleEl = document.getElementById('chapter-title');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const themeToggle = document.getElementById('theme-toggle');
  const chaptersToggle = document.getElementById('chapters-toggle');

  // If essential elements missing, write a clear message and stop
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

  /* CHAPTERS LIST SHOW/HIDE (persisted) */
  const bodyEl = document.body;
  function applyChaptersVisibility(hidden){
    if(hidden) bodyEl.classList.add('chapters-hidden');
    else bodyEl.classList.remove('chapters-hidden');
    if(chaptersToggle) {
      chaptersToggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    }
    localStorage.setItem('chapters-hidden', hidden ? '1' : '0');
  }
  function toggleChapters(){
    const isHidden = bodyEl.classList.contains('chapters-hidden');
    applyChaptersVisibility(!isHidden);
  }
  (function initChaptersVisibility(){
    const saved = localStorage.getItem('chapters-hidden');
    applyChaptersVisibility(saved === '1'); // default: visible (no class)
  })();
  if(chaptersToggle){
    chaptersToggle.addEventListener('click', toggleChapters);
  }

  /* NAV BUTTONS */
  function updateNavButtons(){
    if(!prevBtn || !nextBtn){ return; }
    if(!chapters || chapters.length === 0){
      prevBtn.disabled = true; nextBtn.disabled = true; return;
    }
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= chapters.length - 1;
  }

  if(prevBtn){
    prevBtn.addEventListener('click', ()=>{ if(currentIndex > 0) goToChapter(currentIndex - 1); });
  }
  if(nextBtn){
    nextBtn.addEventListener('click', ()=>{ if(currentIndex < chapters.length - 1) goToChapter(currentIndex + 1); });
  }

  // Keyboard nav (ignore when focusing inputs)
  document.addEventListener('keydown', (e)=>{
    const active = document.activeElement;
    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if(e.key === 'ArrowLeft' && currentIndex > 0) goToChapter(currentIndex - 1);
    if(e.key === 'ArrowRight' && currentIndex < chapters.length - 1) goToChapter(currentIndex + 1);
  });

  /* LOAD CHAPTER LIST */
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
      if(prevBtn) prevBtn.disabled = true;
      if(nextBtn) nextBtn.disabled = true;
    }
  }

  /* LOAD SINGLE CHAPTER */
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
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message + '\nПроверьте, что файл chapters/' + filename + ' существует.';
      console.error('loadChapter error:', err);
    }
  }

  function goToChapter(index){
    if(!chapters || index < 0 || index >= chapters.length) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    // Ensure chapter list remains visible or keep previous hidden state; nothing else to do.
  }

  // start
  loadChapters();
});
