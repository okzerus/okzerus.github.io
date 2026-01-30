// script.js - full replacement with inline palette color picker + rest of features preserved
document.addEventListener('DOMContentLoaded', () => {
  // DOM refs
  const chaptersListEl = document.getElementById('chapters');
  const chapterBodyEl = document.getElementById('chapter-body');
  const chapterTitleEl = document.getElementById('chapter-title');
  const themeToggle = document.getElementById('theme-toggle'); // now opens color popup
  const headerEl = document.querySelector('header');

  const bottomPrev = document.getElementById('bottom-prev');
  const bottomNext = document.getElementById('bottom-next');
  const bottomNav = document.getElementById('bottom-nav');

  const topPrev = document.getElementById('top-prev');
  const topNext = document.getElementById('top-next');
  const topNav = document.getElementById('top-nav');

  const chaptersAside = document.getElementById('chapters-list');

  // Color picker elements
  const colorPopup = document.getElementById('color-popup');
  const paletteSV = document.getElementById('palette-sv'); // canvas saturation/value
  const paletteHue = document.getElementById('palette-hue'); // canvas hue strip
  const swatchCurrent = document.getElementById('swatch-current');
  const swatchDefault = document.getElementById('swatch-default');
  const colorSaveBtn = document.getElementById('color-save');
  const colorResetBtn = document.getElementById('color-reset');

  if(!chaptersListEl || !chapterBodyEl || !chapterTitleEl){
    console.error('Essential DOM elements missing. Check index.html IDs.');
    if(chapterBodyEl) chapterBodyEl.textContent = 'Ошибка: элементы страницы отсутствуют. Проверьте index.html.';
    return;
  }

  /* ---------- app state ---------- */
  let chapters = [];
  let currentIndex = -1;
  let lastChapterFile = null;

  const resolvedUrlCache = new Map();
  const preloadedImgCache = new Map();

  /* ---------- color picker state & helpers ---------- */
  const STORAGE_KEY = 'site-bg-color';
  const DEFAULT_BG = '#0b0f13'; // your dark default

  // HSV internal representation: h [0,360), s [0,1], v [0,1]
  let hue = 210; // default hue (near dark blue) - will be replaced by saved color on init
  let sat = 0.3;
  let valBrightness = 0.06; // low brightness by default to match dark bg

  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  function hsvToRgb(h, s, v){
    h = (h % 360 + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r=0,g=0,b=0;
    if (h < 60) [r,g,b] = [c,x,0];
    else if (h < 120) [r,g,b] = [x,c,0];
    else if (h < 180) [r,g,b] = [0,c,x];
    else if (h < 240) [r,g,b] = [0,x,c];
    else if (h < 300) [r,g,b] = [x,0,c];
    else [r,g,b] = [c,0,x];
    return { r: Math.round((r+m)*255), g: Math.round((g+m)*255), b: Math.round((b+m)*255) };
  }
  function rgbToHex(r,g,b){ return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join(''); }
  function hexToRgb(hex){
    hex = hex.replace('#','');
    if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
    const n = parseInt(hex,16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  }

  function luminanceFromRgb(r,g,b){
    const srgb = [r,g,b].map(v=>{
      v /= 255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
  }

  function setCssBgFromHsv(h,s,v){
    const rgb = hsvToRgb(h,s,v);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    // set --bg to hex
    document.documentElement.style.setProperty('--bg', hex);
    // update swatch
    if(swatchCurrent) swatchCurrent.style.background = hex;
    if(swatchDefault) swatchDefault.style.background = DEFAULT_BG;
    // decide text color by luminance of background
    const lum = luminanceFromRgb(rgb.r, rgb.g, rgb.b);
    if(lum < 0.45){
      document.documentElement.style.setProperty('--accent', '#e6eef6');
      document.documentElement.style.setProperty('--btn-fg', '#e6eef6');
    } else {
      document.documentElement.style.setProperty('--accent', '#132029');
      document.documentElement.style.setProperty('--btn-fg', '#132029');
    }
    // tooltip link color slight variation
    document.documentElement.style.setProperty('--tooltip-link-color', lum < 0.45 ? '#bfe8ff' : '#1b6ea1');
  }

  function setHsvFromHex(hex){
    const { r, g, b } = hexToRgb(hex);
    // convert rgb->hsv
    const rn = r/255, gn = g/255, bn = b/255;
    const max = Math.max(rn,gn,bn), min = Math.min(rn,gn,bn);
    const d = max - min;
    let h = 0;
    if(d === 0) h = 0;
    else if(max === rn) h = ((gn - bn) / d) % 6;
    else if(max === gn) h = ((bn - rn) / d) + 2;
    else h = ((rn - gn) / d) + 4;
    h = Math.round(h * 60);
    if(h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    hue = h;
    sat = s;
    valBrightness = v;
  }

  // Initialize with saved color or default
  function initColorFromStorage(){
    const saved = localStorage.getItem(STORAGE_KEY);
    const hex = saved || DEFAULT_BG;
    setHsvFromHex(hex);
    setCssBgFromHsv(hue, sat, valBrightness);
  }

  /* ---------- palette drawing ---------- */
  function drawHueStrip(){
    if(!paletteHue) return;
    const ctx = paletteHue.getContext('2d');
    const w = paletteHue.width;
    const h = paletteHue.height;
    const grad = ctx.createLinearGradient(0,0,w,0);
    // create hue gradient
    for(let i=0;i<=360;i+=15){
      const c = hsvToRgb(i/1,1,1);
      grad.addColorStop(i/360, `rgb(${c.r},${c.g},${c.b})`);
    }
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,w,h);
    // draw indicator
    const x = (hue % 360) / 360 * w;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(Math.round(x)-2,1,4,h-2); ctx.stroke();
  }

  function drawSVSquare(){
    if(!paletteSV) return;
    const ctx = paletteSV.getContext('2d');
    const w = paletteSV.width;
    const h = paletteSV.height;

    // create saturation gradient (left white->right full hue)
    const hueRgb = hsvToRgb(hue,1,1);
    // fill with solid hue color first
    ctx.fillStyle = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
    ctx.fillRect(0,0,w,h);
    // overlay white gradient left->transparent
    const whiteGrad = ctx.createLinearGradient(0,0,w,0);
    whiteGrad.addColorStop(0,'rgba(255,255,255,1)');
    whiteGrad.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0,0,w,h);
    // overlay black gradient top->bottom (transparent->black)
    const blackGrad = ctx.createLinearGradient(0,0,0,h);
    blackGrad.addColorStop(0,'rgba(0,0,0,0)');
    blackGrad.addColorStop(1,'rgba(0,0,0,1)');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0,0,w,h);

    // draw selector circle at sat/val position
    const selX = clamp(sat,0,1) * w;
    const selY = (1 - clamp(valBrightness,0,1)) * h; // value 1 top => y=0, value 0 bottom => y=h
    ctx.strokeStyle = (valBrightness > 0.5 ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.95)');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(selX, selY, 8, 0, Math.PI*2);
    ctx.stroke();
  }

  // utility: compute hex from current hsv
  function currentHex(){ const {r,g,b} = hsvToRgb(hue, sat, valBrightness); return rgbToHex(r,g,b); }

  /* ---------- palette interaction handlers ---------- */
  function installPaletteHandlers(){
    // SV square drag
    if(paletteSV){
      let svDown = false;
      const rect = () => paletteSV.getBoundingClientRect();
      const handleSV = (clientX, clientY) => {
        const r = rect();
        const x = clamp((clientX - r.left) / r.width, 0, 1);
        const y = clamp((clientY - r.top) / r.height, 0, 1);
        // x -> saturation
        sat = x;
        // y -> value (inversed: top = 0 -> white, we want top = bright)
        valBrightness = 1 - y;
        drawSVSquare();
        drawHueStrip();
        const hex = currentHex();
        setCssBgFromHsv(hue, sat, valBrightness);
      };
      paletteSV.addEventListener('mousedown', (e) => { svDown = true; handleSV(e.clientX, e.clientY); });
      window.addEventListener('mousemove', (e) => { if(!svDown) return; handleSV(e.clientX, e.clientY); });
      window.addEventListener('mouseup', () => { svDown = false; });
      // touch
      paletteSV.addEventListener('touchstart', (e) => { e.preventDefault(); svDown = true; const t = e.touches[0]; handleSV(t.clientX, t.clientY); });
      window.addEventListener('touchmove', (e) => { if(!svDown) return; const t = e.touches[0]; handleSV(t.clientX, t.clientY); }, {passive:false});
      window.addEventListener('touchend', () => { svDown = false; });
    }

    // Hue strip drag
    if(paletteHue){
      let hueDown = false;
      const rectH = () => paletteHue.getBoundingClientRect();
      const handleHue = (clientX) => {
        const r = rectH();
        const x = clamp((clientX - r.left) / r.width, 0, 1);
        hue = x * 360;
        drawHueStrip();
        drawSVSquare();
        const hex = currentHex();
        setCssBgFromHsv(hue, sat, valBrightness);
      };
      paletteHue.addEventListener('mousedown', (e) => { hueDown = true; handleHue(e.clientX); });
      window.addEventListener('mousemove', (e) => { if(!hueDown) return; handleHue(e.clientX); });
      window.addEventListener('mouseup', () => { hueDown = false; });
      // touch
      paletteHue.addEventListener('touchstart', (e) => { e.preventDefault(); hueDown = true; const t = e.touches[0]; handleHue(t.clientX); });
      window.addEventListener('touchmove', (e) => { if(!hueDown) return; const t = e.touches[0]; handleHue(t.clientX); }, {passive:false});
      window.addEventListener('touchend', () => { hueDown = false; });
    }
  }

  /* ---------- color popup open/close ---------- */
  function showColorPopup(){
    if(!colorPopup) return;
    colorPopup.classList.add('visible');
    colorPopup.setAttribute('aria-hidden','false');
    // re-draw palette to reflect current hue/sat/val
    drawHueStrip();
    drawSVSquare();
    document.addEventListener('click', onDocClickForPopup);
  }
  function hideColorPopup(){
    if(!colorPopup) return;
    colorPopup.classList.remove('visible');
    colorPopup.setAttribute('aria-hidden','true');
    document.removeEventListener('click', onDocClickForPopup);
  }
  function onDocClickForPopup(e){
    if(!colorPopup) return;
    if(colorPopup.contains(e.target) || (themeToggle && themeToggle.contains(e.target))) return;
    hideColorPopup();
  }
  if(themeToggle) themeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if(!colorPopup) return;
    if(colorPopup.classList.contains('visible')) hideColorPopup(); else showColorPopup();
  });

  // Save / Reset buttons
  if(colorSaveBtn) colorSaveBtn.addEventListener('click', () => {
    try { localStorage.setItem(STORAGE_KEY, currentHex()); } catch(e){}
    hideColorPopup();
  });
  if(colorResetBtn) colorResetBtn.addEventListener('click', () => {
    // reset to default
    setHsvFromHex(DEFAULT_BG);
    drawHueStrip(); drawSVSquare();
    setCssBgFromHsv(hue, sat, valBrightness);
    try { localStorage.removeItem(STORAGE_KEY); } catch(e){}
    hideColorPopup();
  });

  // clicking default swatch resets quickly
  if(swatchDefault) swatchDefault.addEventListener('click', () => {
    setHsvFromHex(DEFAULT_BG);
    drawHueStrip(); drawSVSquare();
    setCssBgFromHsv(hue, sat, valBrightness);
  });

  /* ---------- initialize color picker ---------- */
  function initColorPicker(){
    // set canvas resolution to CSS pixels * devicePixelRatio for crispness
    if(paletteSV){ const d = window.devicePixelRatio||1; const cssW = paletteSV.clientWidth; const cssH = paletteSV.clientHeight; paletteSV.width = Math.round(cssW * d); paletteSV.height = Math.round(cssH * d); paletteSV.style.width = cssW + 'px'; paletteSV.style.height = cssH + 'px'; paletteSV.getContext('2d').scale(d,d); }
    if(paletteHue){ const d = window.devicePixelRatio||1; const cssW = paletteHue.clientWidth; const cssH = paletteHue.clientHeight; paletteHue.width = Math.round(cssW * d); paletteHue.height = Math.round(cssH * d); paletteHue.style.width = cssW + 'px'; paletteHue.style.height = cssH + 'px'; paletteHue.getContext('2d').scale(d,d); }

    // load saved color
    const saved = localStorage.getItem(STORAGE_KEY);
    if(saved){
      setHsvFromHex(saved);
    } else {
      setHsvFromHex(DEFAULT_BG);
    }
    drawHueStrip();
    drawSVSquare();
    setCssBgFromHsv(hue, sat, valBrightness);
    installPaletteHandlers();
  }

  /* ---------- rest of app (chapters, tooltips, viewer, nav etc.) ----------
     For readability this code follows the previously working structure: loading chapters.json,
     "done" flag behavior, slide-out chapters list, tippy tooltip preloading and banner images,
     image viewer with zoom & drag, top/bottom nav with 1s hide rule, scroll restore on reload only.
  -------------------------------------------------------------------------- */

  /* ----- helpers for "done" logic ----- */
  function isDoneEntry(entry){ if(!entry) return false; return entry.done !== false; }
  function findPrevDoneIndex(fromIndex){ for (let i = (fromIndex===undefined? currentIndex-1: fromIndex); i>=0; i--) if(isDoneEntry(chapters[i])) return i; return -1; }
  function findNextDoneIndex(fromIndex){ for (let i = (fromIndex===undefined? currentIndex+1: fromIndex); i<chapters.length; i++) if(isDoneEntry(chapters[i])) return i; return -1; }
  function findFirstDoneIndex(){ return findNextDoneIndex(0); }

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
    if(!chapters || index<0 || index>=chapters.length) return;
    if(!isDoneEntry(chapters[index])) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    window.scrollTo({ top:0, behavior:'auto' });
    if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); else clearHideTimer();
    closeChapters();
    try{ localStorage.setItem('last-chapter-file', c.file); } catch(e){}
  }

  // attach nav handlers
  if(bottomPrev) bottomPrev.addEventListener('click', ()=>{ const i = Number(bottomPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(bottomNext) bottomNext.addEventListener('click', ()=>{ const i = Number(bottomNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topPrev) topPrev.addEventListener('click', ()=>{ const i = Number(topPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topNext) topNext.addEventListener('click', ()=>{ const i = Number(topNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });

  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if(active && (active.tagName==='INPUT' || active.tagName==='TEXTAREA' || active.isContentEditable)) return;
    if(e.key === 'ArrowLeft'){ const p = findPrevDoneIndex(); if(p!==-1) goToChapter(p); }
    if(e.key === 'ArrowRight'){ const n = findNextDoneIndex(); if(n!==-1) goToChapter(n); }
  });

  /* ---------- load chapters.json ---------- */
  async function loadChapters(){
    chapterBodyEl.textContent = 'Загрузка...';
    try{
      const res = await fetch('chapters.json', { cache:'no-store' });
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
        if(!isDoneEntry(c)){ a.classList.add('undone'); } else { a.addEventListener('click', (e)=>{ e.preventDefault(); goToChapter(i); }); }
        li.appendChild(a); chaptersListEl.appendChild(li);
      });

      const saved = localStorage.getItem('last-chapter-file');
      if(saved){
        const idx = chapters.findIndex(ch => ch && ch.file === saved && isDoneEntry(ch));
        if(idx !== -1){ goToChapter(idx); return; }
      }
      const first = findFirstDoneIndex();
      if(first !== -1) goToChapter(first); else { chapterBodyEl.textContent = 'В репозитории нет доступных (done) глав.'; updateNavButtons(); }
    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message;
      console.error('loadChapters error:', err);
      [bottomPrev,bottomNext,topPrev,topNext].forEach(b => { if(b) b.disabled = true; });
    }
  }

  /* ---------- load single chapter ---------- */
  async function loadChapter(filename, title){
    chapterTitleEl.textContent = title || '';
    chapterBodyEl.textContent = 'Загрузка главы...';
    try{
      const res = await fetch('chapters/' + filename, { cache:'no-store' });
      if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + filename);
      const md = await res.text();
      lastChapterFile = filename;
      const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: библиотека marked не загружена.</p>';
      chapterBodyEl.innerHTML = html;

      preloadTooltipImages();
      initGlossTippy();
      bindImagesToViewer();
      updateNavButtons();

      // restore scroll only if sessionStorage had it (reload scenario)
      try{
        const key = 'scroll:' + filename;
        const v = sessionStorage.getItem(key);
        if(v !== null){
          const scrollVal = Number(v) || 0;
          requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ window.scrollTo({ top: scrollVal, behavior:'auto' }); try{ sessionStorage.removeItem(key); }catch(e){} if(window.scrollY<=10 && !bottomNavIsVisible()) showTopNavImmediate(); }); });
        } else {
          if(window.scrollY<=10 && !bottomNavIsVisible()) showTopNavImmediate();
        }
      }catch(e){ if(window.scrollY<=10 && !bottomNavIsVisible()) showTopNavImmediate(); }

    }catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
      console.error('loadChapter error:', err);
    }
  }

  /* ---------- image resolution/test (for tooltips) ---------- */
  function testImageUrl(url, timeout = 3000){
    return new Promise((resolve)=>{
      const img = new Image();
      let done = false;
      const onLoad = () => { if(done) return; done = true; cleanup(); resolve(true); };
      const onErr = () => { if(done) return; done = true; cleanup(); resolve(false); };
      const cleanup = () => { img.onload = img.onerror = null; clearTimeout(timer); };
      img.onload = onLoad; img.onerror = onErr; img.src = url;
      const timer = setTimeout(() => { if(done) return; done = true; cleanup(); resolve(false); }, timeout);
    });
  }

  async function resolveTooltipImage(srcCandidate){
    if(!srcCandidate) return null;
    if(resolvedUrlCache.has(srcCandidate)) return resolvedUrlCache.get(srcCandidate);

    if(/^https?:\/\//i.test(srcCandidate) || srcCandidate.startsWith('/')){
      if(await testImageUrl(srcCandidate)){ resolvedUrlCache.set(srcCandidate, srcCandidate); return srcCandidate; }
    }

    const bases = [];
    bases.push(window.location.href);
    bases.push(window.location.origin + window.location.pathname);
    if(lastChapterFile){
      bases.push(window.location.origin + '/' + lastChapterFile);
      const parts = lastChapterFile.split('/'); parts.pop();
      const parent = parts.join('/');
      if(parent) bases.push(window.location.origin + '/' + parent + '/');
    }
    bases.push(window.location.origin + '/');

    const candidates = [];
    for(const base of bases){ try{ const u = new URL(srcCandidate, base); candidates.push(u.href); }catch(e){} }
    const seen = new Set();
    const unique = candidates.filter(c => { if(seen.has(c)) return false; seen.add(c); return true; });

    for(const u of unique){
      if(await testImageUrl(u)){ resolvedUrlCache.set(srcCandidate, u); return u; }
    }
    resolvedUrlCache.set(srcCandidate, null);
    return null;
  }

  /* ---------- preload tooltip images ---------- */
  async function preloadTooltipImages(){
    if(!chapterBodyEl) return;
    const glossEls = Array.from(chapterBodyEl.querySelectorAll('.gloss'));
    if(!glossEls.length) return;
    for(const el of glossEls){
      const dataImg = el.getAttribute('data-img'); if(!dataImg) continue;
      if(resolvedUrlCache.has(dataImg) && resolvedUrlCache.get(dataImg) === null) continue;
      try{
        const resolved = await resolveTooltipImage(dataImg);
        if(resolved){
          if(preloadedImgCache.has(resolved)) continue;
          const pimg = new Image();
          pimg.crossOrigin = 'anonymous'; pimg.decoding = 'async';
          preloadedImgCache.set(resolved, pimg);
          pimg.onload = () => {};
          pimg.onerror = () => { preloadedImgCache.delete(resolved); };
          pimg.src = resolved;
        }
      }catch(err){}
    }
  }

  // re-preload on visibilitychange
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'visible'){
      if(!chapterBodyEl) return;
      const glossEls = Array.from(chapterBodyEl.querySelectorAll('.gloss'));
      glossEls.forEach(async el => {
        const dataImg = el.getAttribute('data-img'); if(!dataImg) return;
        const resolved = resolvedUrlCache.has(dataImg) ? resolvedUrlCache.get(dataImg) : await resolveTooltipImage(dataImg);
        if(resolved && (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete)){
          try{ const pimg = new Image(); pimg.crossOrigin='anonymous'; pimg.decoding='async'; preloadedImgCache.set(resolved,pimg); pimg.onload=()=>{}; pimg.onerror=()=>{ preloadedImgCache.delete(resolved); }; pimg.src = resolved; }catch(e){}
        }
      });
    }
  });

  /* ---------- tippy setup for .gloss (banner image + preloaded) ---------- */
  function initGlossTippy(){
    if(!window.tippy) return;
    document.querySelectorAll('.gloss').forEach(el => { try{ if(el._tippy) el._tippy.destroy(); }catch(e){} });

    tippy('.gloss', {
      allowHTML:true, interactive:true, delay:[60,80], maxWidth:520, placement:'top', offset:[0,8],
      appendTo: () => document.body,
      popperOptions: { strategy: 'fixed', modifiers: [ { name:'computeStyles', options:{adaptive:false} }, { name:'preventOverflow', options:{ padding:8, altAxis:true } }, { name:'flip', options:{ fallbackPlacements:['bottom','right','left'] } } ] },
      content: 'Loading...',
      onShow: async (instance) => {
        const reference = instance.reference;
        let contentHTML = reference.getAttribute('data-tippy-content') || reference.getAttribute('data-tip') || reference.getAttribute('title') || reference.innerHTML || '';
        if(reference.getAttribute('title')) reference.removeAttribute('title');

        const dataImg = reference.getAttribute('data-img');
        const imgAlt = reference.getAttribute('data-img-alt') || '';

        const wrapper = document.createElement('div');

        let resolved = null;
        if(dataImg){
          if(resolvedUrlCache.has(dataImg)) resolved = resolvedUrlCache.get(dataImg);
          else resolved = await resolveTooltipImage(dataImg);
        }

        if(resolved){
          if(!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete){
            try{ const pimg = new Image(); pimg.crossOrigin='anonymous'; pimg.decoding='async'; preloadedImgCache.set(resolved,pimg); pimg.onload=()=>{}; pimg.onerror=()=>{ preloadedImgCache.delete(resolved); }; pimg.src = resolved; }catch(e){}
          }
          const imgEl = document.createElement('img');
          imgEl.className = 'tooltip-img';
          imgEl.src = resolved;
          imgEl.alt = imgAlt;
          imgEl.loading = 'eager';
          imgEl.style.cursor = 'pointer';
          imgEl.addEventListener('click', (ev)=>{ ev.stopPropagation(); try{ openImageViewer(resolved, imgAlt); }catch(e){} try{ instance.hide(); }catch(e){} });
          imgEl.addEventListener('load', ()=>{ try{ if(instance.popperInstance && typeof instance.popperInstance.update==='function') instance.popperInstance.update(); else if(typeof instance.update==='function') instance.update(); }catch(e){} });
          wrapper.appendChild(imgEl);
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'tooltip-body';
        contentDiv.innerHTML = contentHTML;
        wrapper.appendChild(contentDiv);

        try{ instance.setContent(wrapper); }catch(e){ instance.setContent(wrapper.outerHTML); }
      }
    });
  }

  function refreshNavTippies(){
    if(!window.tippy) return;
    [bottomPrev,bottomNext,topPrev,topNext].forEach(btn => { if(!btn) return; try{ if(btn._tippy) btn._tippy.destroy(); }catch(e){} });
    if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement:'top', delay:[80,40], offset:[0,8], appendTo:()=>document.body });
    if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement:'top', delay:[80,40], offset:[0,8], appendTo:()=>document.body });
    if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement:'bottom', delay:[80,40], offset:[0,8], appendTo:()=>document.body });
    if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement:'bottom', delay:[80,40], offset:[0,8], appendTo:()=>document.body });
  }

  /* ---------- chapters aside slide behavior ---------- */
  let chaptersOpen = false;
  const EDGE_TRIGGER_PX = 12;
  function openChapters(){ if(chaptersOpen) return; chaptersOpen = true; document.body.classList.add('chapters-open'); }
  function closeChapters(){ if(!chaptersOpen) return; chaptersOpen = false; document.body.classList.remove('chapters-open'); }

  document.addEventListener('mousemove', (e)=>{ if(window.innerWidth <=700) return; if(e.clientX <= EDGE_TRIGGER_PX) openChapters(); });
  if(chaptersAside){ chaptersAside.addEventListener('mouseenter', openChapters); chaptersAside.addEventListener('mouseleave', (ev)=>{ if(ev.clientX <= EDGE_TRIGGER_PX) return; closeChapters(); }); }
  document.addEventListener('click', (e)=>{ if(!chaptersOpen) return; if(chaptersAside && chaptersAside.contains(e.target)) return; if(e.clientX <= EDGE_TRIGGER_PX) return; closeChapters(); });

  /* ---------- top nav visibility (1s hide delay) ---------- */
  function positionTopNav(){ if(!topNav || !headerEl) return; const hRect = headerEl.getBoundingClientRect(); const topNavRect = topNav.getBoundingClientRect(); const top = Math.max(6, hRect.top + (hRect.height/2) - (topNavRect.height/2)); topNav.style.top = `${top}px`; }

  let lastScrollY = window.scrollY; let scheduled = false; let hideDelayTimer = null; const HIDE_DELAY_MS = 1000;
  function clearHideTimer(){ if(hideDelayTimer){ clearTimeout(hideDelayTimer); hideDelayTimer = null; } }
  function bottomNavIsVisible(){ if(!bottomNav) return false; const r = bottomNav.getBoundingClientRect(); return (r.top < window.innerHeight) && (r.bottom > 0); }
  function showTopNavImmediate(){ if(bottomNavIsVisible()){ hideTopNavImmediate(); return; } if(!topNav) return; topNav.classList.add('visible-top'); topNav.setAttribute('aria-hidden','false'); clearHideTimer(); }
  function hideTopNavImmediate(){ if(!topNav) return; topNav.classList.remove('visible-top'); topNav.setAttribute('aria-hidden','true'); clearHideTimer(); }
  function scheduleHideTopNav(){ if(hideDelayTimer) return; hideDelayTimer = setTimeout(()=>{ if(!bottomNavIsVisible()) hideTopNavImmediate(); hideDelayTimer=null; }, HIDE_DELAY_MS); }

  function onScrollCheck(){
    const curY = window.scrollY; const scrollingUp = curY < lastScrollY; const atTop = curY <= 10;
    if(bottomNavIsVisible()){ hideTopNavImmediate(); clearHideTimer(); }
    else if(atTop || scrollingUp){ clearHideTimer(); showTopNavImmediate(); }
    else { scheduleHideTopNav(); }
    lastScrollY = curY;
  }

  window.addEventListener('scroll', ()=>{ if(scheduled) return; scheduled = true; requestAnimationFrame(()=>{ onScrollCheck(); scheduled=false; }); }, { passive:true });
  window.addEventListener('resize', ()=>{ positionTopNav(); onScrollCheck(); });

  const observer = new IntersectionObserver((entries)=>{ const anyVisible = entries.some(en => en.isIntersecting); if(anyVisible) hideTopNavImmediate(); }, { root:null, threshold:0.01 });
  if(bottomNav) observer.observe(bottomNav);

  function initialTopNavSetup(){ positionTopNav(); if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); else hideTopNavImmediate(); }
  initialTopNavSetup(); setTimeout(initialTopNavSetup, 80);

  /* ---------- image viewer ---------- */
  if(!document.getElementById('image-overlay')){ const overlay = document.createElement('div'); overlay.id = 'image-overlay'; overlay.innerHTML = `<div class="viewer" role="dialog" aria-modal="true"><img class="viewer-img" src="" alt=""></div>`; document.body.appendChild(overlay); }
  const overlay = document.getElementById('image-overlay'); const overlayImg = overlay.querySelector('.viewer-img');

  let isZoomed = false; let pointerDown = false; let pointerStart = {x:0,y:0}; let imgPos = {x:0,y:0}; let dragMoved = false; let suppressClick = false; const DRAG_THRESHOLD = 4;

  function openImageViewer(src, alt=''){
    overlayImg.src = src; overlayImg.alt = alt||'';
    const marginPx = 40;
    overlayImg.style.maxWidth = `calc(100vw - ${marginPx}px)`; overlayImg.style.maxHeight = `calc(100vh - ${Math.round(marginPx*1.5)}px)`;
    overlay.classList.add('visible'); isZoomed=false; imgPos={x:0,y:0}; overlayImg.style.transform=`translate(0px,0px) scale(1)`; overlayImg.classList.remove('zoomed');
    overlay.style.cursor='default'; document.body.style.overflow='hidden';
    const viewer = overlay.querySelector('.viewer'); if(viewer){ viewer.scrollTop=0; viewer.scrollLeft=0; }
  }
  function closeImageViewer(){ overlay.classList.remove('visible'); overlayImg.src=''; isZoomed=false; pointerDown=false; dragMoved=false; suppressClick=false; document.body.style.overflow=''; overlayImg.style.maxWidth=''; overlayImg.style.maxHeight=''; }
  function applyImageTransform(){ const scale = isZoomed ? 2 : 1; overlayImg.style.transform = `translate(${imgPos.x}px, ${imgPos.y}px) scale(${scale})`; if(isZoomed) overlayImg.classList.add('zoomed'); else overlayImg.classList.remove('zoomed'); }

  overlayImg.addEventListener('click', (ev)=>{ if(suppressClick){ suppressClick=false; return; } isZoomed=!isZoomed; if(!isZoomed) imgPos={x:0,y:0}; applyImageTransform(); });
  overlayImg.addEventListener('mousedown', (ev)=>{ if(!isZoomed) return; ev.preventDefault(); pointerDown=true; dragMoved=false; pointerStart={x:ev.clientX,y:ev.clientY}; overlayImg.style.cursor='grabbing'; });
  window.addEventListener('mousemove', (ev)=>{ if(!pointerDown||!isZoomed) return; const dx = ev.clientX - pointerStart.x; const dy = ev.clientY - pointerStart.y; if(!dragMoved && (Math.abs(dx)+Math.abs(dy) >= DRAG_THRESHOLD)) dragMoved=true; if(dragMoved){ pointerStart={x:ev.clientX,y:ev.clientY}; imgPos.x += dx; imgPos.y += dy; applyImageTransform(); } });
  window.addEventListener('mouseup', (ev)=>{ if(pointerDown && dragMoved){ suppressClick=true; setTimeout(()=>{ suppressClick=false; },0); } pointerDown=false; overlayImg.style.cursor = isZoomed ? 'grab' : 'zoom-in'; });
  overlay.addEventListener('click', (ev)=>{ if(ev.target === overlay) closeImageViewer(); });
  window.addEventListener('keydown', (ev)=>{ if(ev.key === 'Escape' && overlay.classList.contains('visible')) closeImageViewer(); });

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

  /* ---------- persist scroll only on unload (sessionStorage) ---------- */
  window.addEventListener('beforeunload', () => {
    try{
      if(currentIndex >=0 && chapters[currentIndex] && chapters[currentIndex].file){
        const key = 'scroll:' + chapters[currentIndex].file;
        sessionStorage.setItem(key, String(window.scrollY || 0));
      }
    }catch(e){}
  });

  /* ---------- utility: nav tippies ---------- */
  function refreshNavTippies(){
    if(!window.tippy) return;
    [bottomPrev,bottomNext,topPrev,topNext].forEach(btn => { if(!btn) return; try{ if(btn._tippy) btn._tippy.destroy(); }catch(e){} });
    if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement:'top', delay:[80,40], offset:[0,8], appendTo:()=>document.body });
    if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement:'top', delay:[80,40], offset:[0,8], appendTo:()=>document.body });
    if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement:'bottom', delay:[80,40], offset:[0,8], appendTo:()=>document.body });
    if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement:'bottom', delay:[80,40], offset:[0,8], appendTo:()=>document.body });
  }

  /* ---------- start ---------- */
  initColorPicker(); // sets bg from storage or default and draws palette
  loadChapters();
  updateNavButtons();
  setTimeout(()=>{ positionTopNav(); if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); }, 120);
});
