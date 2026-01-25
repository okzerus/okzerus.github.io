// Simple site script: loads chapters.json, shows list, loads markdown, enables tippy tooltips.


const chaptersListEl = document.getElementById('chapters');
const chapterBodyEl = document.getElementById('chapter-body');
const chapterTitleEl = document.getElementById('chapter-title');


async function loadChapters(){
try{
const res = await fetch('chapters.json');
const chapters = await res.json();
chapters.forEach((c, i)=>{
const li = document.createElement('li');
const a = document.createElement('a');
a.href = '#'; a.textContent = c.title;
a.addEventListener('click', (e)=>{ e.preventDefault(); loadChapter(c.file, c.title); });
li.appendChild(a);
chaptersListEl.appendChild(li);
});
if(chapters.length) loadChapter(chapters[0].file, chapters[0].title);
}catch(err){
chapterBodyEl.textContent = 'Ошибка: не могу загрузить chapters.json';
console.error(err);
}
}


async function loadChapter(filename, title){
chapterTitleEl.textContent = title || '';
chapterBodyEl.textContent = 'Загрузка...';
try{
const res = await fetch('chapters/' + filename);
if(!res.ok) throw new Error('not found');
const md = await res.text();
// Convert Markdown to HTML
const html = marked.parse(md);
chapterBodyEl.innerHTML = html;
// Initialize tippy on elements with class 'gloss'
if(window.tippy) {
tippy('.gloss', {
allowHTML: true,
interactive: true,
delay: [100, 100]
});
}
}catch(err){
chapterBodyEl.textContent = 'Ошибка: не могу загрузить главу';
console.error(err);
}
}


loadChapters();
