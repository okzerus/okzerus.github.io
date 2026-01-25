// script.js - robust chapter loader + theme toggle + tippy init + prev/next nav

const chaptersListEl = document.getElementById('chapters');
const chapterBodyEl = document.getElementById('chapter-body');
const chapterTitleEl = document.getElementById('chapter-title');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const themeToggle = document.getElementById('theme-toggle');

let chapters = [];
let currentIndex = -1;

// THEME: read/save
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('site-theme', theme);
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}
// initialize theme from localStorage or default 'dark'
(function initTheme(){
  const saved = localStorage.getItem('site-theme');
  applyTheme(saved === 'light' ? 'light' : 'dark');
})();

themeToggle.addEventListener('click', toggleTheme);

// NAV BUTTONS
function updateNavButtons(){
  if(!chapters || chapters.length === 0){
    prevBtn.disabled = true; nextBtn.disabled = true; return;
  }
  prevBtn.disabled = currentIndex <= 0;
  nextBtn.disabled = currentIndex >= chapters.length - 1;
}

prevBtn.addEventListener('click', ()=>{ if(currentIndex > 0) goToChapter(currentIndex - 1); });
nextBtn.addEventListener('click', ()=>{ if(currentIndex < chapters.length - 1) goToChapter(currentIndex + 1); });

// Keyboard nav for convenience
document.addEventListener('keydown', (e)=>{
  // only react if user is not typing in an input or textarea
  const active = document.activeElement;
  if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  if(e.key === 'ArrowLeft' && currentIndex > 0) goToChapter(currentIndex - 1);
  if(e.key === 'ArrowRight' && currentIndex < chapters.length - 1) goToChapter(currentIndex + 1);
});

// LOAD CHAPTER LIST
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
  }
}

// LOAD SINGLE CHAPTER
async function loadChapter(filename, title){
  chapterTitleEl.textContent = title || '';
  chapterBodyEl.textContent = 'Загрузка главы...';
  try{
    const res = await fetch('chapters/' + filename, {cache: 'no-store'});
    if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + filename);
    const md = await res.text();
    const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: библиотека marked не загружена.</p>';
    chapterBodyEl.innerHTML = html;
    // Init tippy on glossary spans
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
}

// start
loadChapters();
