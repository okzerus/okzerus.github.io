// Script: persistent chapter navigation + floating buttons
// LOADING CHAPTERS
async function loadChapters(){
chapterBodyEl.textContent = 'Загрузка...';
try{
const res = await fetch('chapters.json');
if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching chapters.json');
chapters = await res.json();
chaptersListEl.innerHTML = '';
chapters.forEach((c, i)=>{
const li = document.createElement('li');
const a = document.createElement('a');
a.href = '#'; a.textContent = c.title;
a.addEventListener('click', (e)=>{ e.preventDefault(); goToChapter(i); });
li.appendChild(a);
chaptersListEl.appendChild(li);
});
if(chapters.length) goToChapter(0);
}catch(err){
chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message;
console.error('loadChapters error:', err);
}
}


async function loadChapter(filename, title){
chapterTitleEl.textContent = title || '';
chapterBodyEl.textContent = 'Загрузка главы...';
try{
const res = await fetch('chapters/' + filename);
if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + filename);
const md = await res.text();
const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: marked библиотека не загружена.</p>';
chapterBodyEl.innerHTML = html;
if(window.tippy) {
tippy('.gloss', { allowHTML: true, interactive: true, delay: [100, 100] });
}
}catch(err){
chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
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


// Init
loadChapters();
