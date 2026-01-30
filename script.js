// script.js - consolidated full app with color palette
// - palette opens under header button and updates --card in real-time
// - chosen palette and darken value saved to localStorage and restored on load
// - keeps all previous features: chapters loading, "done" flag, slide-out list, tippy tooltips (preload), image viewer, top/bottom nav behavior

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- DOM refs ---------- */
  const chaptersListEl = document.getElementById('chapters');
  const chapterBodyEl = document.getElementById('chapter-body');
  const chapterTitleEl = document.getElementById('chapter-title');

  const themeToggle = document.getElementById('theme-toggle'); // now opens palette
  const colorPalette = document.getElementById('color-palette');
  const colorInput = document.getElementById('color-input');
  const darkenRange = document.getElementById('darken-range');
  const darkenVal = document.getElementById('darken-val');
  const paletteReset = document.getElementById('palette-reset');
  const paletteClose = document.getElementById('palette-close');

  const headerEl = document.querySelector('header');
  const bottomPrev = document.getElementById('bottom-prev');
  const bottomNext = document.getElementById('bottom-next');
  const bottomNav = document.getElementById('bottom-nav');
  const topPrev = document.getElementById('top-prev');
  const topNext = document.getElementById('top-next');
  const topNav = document.getElementById('top-nav');
  const chaptersAside = document.getElementById('chapters-list');

  if (!chaptersListEl || !chapterBodyEl || !chapterTitleEl) {
    console.error('Essential DOM elements missing. Check index.html IDs.');
    if (chapterBodyEl) chapterBodyEl.textContent = 'Ошибка: элементы страницы отсутствуют. Проверьте index.html.';
    return;
  }

  /* ---------- App state ---------- */
  let chapters = [];
  let currentIndex = -1;
  let lastChapterFile = null;

  // tippy image caches
  const resolvedUrlCache = new Map();
  const preloadedImgCache = new Map();

  /* ---------- Theme init (keep theme variables, but button no longer toggles theme) ---------- */
  function setThemeIcon(theme) {
    // keep sun icon design: sun when site in dark (indicates light), moon when light
    if (!themeToggle) return;
    themeToggle.textContent = (theme === 'dark') ? '☀︎' : '☾';
  }
  (function initTheme(){
    const saved = localStorage.getItem('site-theme');
    const theme = (saved === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
    setThemeIcon(theme);
  })();

  /* ---------- Color palette logic ---------- */

  // Helper: clamp
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // Hex <-> HSL helpers
  function hexToRgb(hex) {
    hex = hex.replace('#','');
    if(hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const bigint = parseInt(hex,16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  }
  function rgbToHex(r,g,b) {
    return '#' + [r,g,b].map(x => {
      const s = Math.round(clamp(x,0,255)).toString(16);
      return s.length===1 ? '0'+s : s;
    }).join('');
  }
  function rgbToHsl(r,g,b) {
    r/=255; g/=255; b/=255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h=0, s=0, l=(max+min)/2;
    if(max!==min){
      const d = max-min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch(max){
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h*360, s: s*100, l: l*100 };
  }
  function hslToRgb(h,s,l){
    h /= 360; s /= 100; l /= 100;
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r:v, g:v, b:v };
    }
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p,q,h + 1/3) * 255);
    const g = Math.round(hue2rgb(p,q,h) * 255);
    const b = Math.round(hue2rgb(p,q,h - 1/3) * 255);
    return { r, g, b };
  }
  function hexToHsl(hex){ const c = hexToRgb(hex); return rgbToHsl(c.r,c.g,c.b); }
  function hslToHex(h,s,l){ const c = hslToRgb(h,s,l); return rgbToHex(c.r,c.g,c.b); }

  // Compute a darker variant by reducing lightness by `delta` percentage points
  function darkenHex(hex, delta) {
    const hsl = hexToHsl(hex);
    hsl.l = clamp(hsl.l - delta, 0, 100);
    return hslToHex(hsl.h, hsl.s, hsl.l);
  }

  // Apply a custom color: set --card to computed darker color.
  // store flag to indicate custom color is active by inline style (JS will set CSS variable)
  function applyCustomColor(baseHex, darkenPct) {
    // darkenPct is e.g. 8 means reduce L by 8 percentage points
    const finalCard = darkenHex(baseHex, darkenPct);
    // Apply inline CSS variable --card (overrides theme value)
    document.documentElement.style.setProperty('--card', finalCard);
  }

  // Reset to theme defaults (remove inline override)
  function resetCustomColor() {
    document.documentElement.style.removeProperty('--card');
    localStorage.removeItem('user-base-color');
    localStorage.removeItem('user-darken-pct');
  }

  // Open/close palette; palette sits under the button; do not blur when open.
  function openPalette(){
    if(!colorPalette) return;
    colorPalette.setAttribute('aria-hidden', 'false');
    colorPalette.classList.add('open');
    themeToggle.setAttribute('aria-expanded', 'true');
    // place palette so it doesn't overflow viewport horizontally (basic placement)
    const rect = themeToggle.getBoundingClientRect();
    const palRect = colorPalette.getBoundingClientRect();
    // try to keep right aligned with button
    colorPalette.style.left = Math.max(8, rect.right - palRect.width) + 'px';
    colorPalette.style.top = rect.bottom + 8 + 'px';
  }
  function closePalette(){
    if(!colorPalette) return;
    colorPalette.setAttribute('aria-hidden', 'true');
    colorPalette.classList.remove('open');
    themeToggle.setAttribute('aria-expanded', 'false');
  }
  function togglePalette(){
    if(colorPalette && colorPalette.getAttribute('aria-hidden') === 'false') closePalette(); else openPalette();
  }

  // Initialize palette UI state from localStorage
  function initPaletteState(){
    // default base should match current dark-mode card value
    // Attempt to read computed value of --card-dark if possible (but simpler: default hex hardcoded to match CSS variable)
    const defaultBase = getComputedStyle(document.documentElement).getPropertyValue('--card-dark').trim() || '#0f1520';
    const savedBase = localStorage.getItem('user-base-color') || defaultBase;
    const savedDarken = Number(localStorage.getItem('user-darken-pct'));
    const darken = Number.isFinite(savedDarken) && !Number.isNaN(savedDarken) ? savedDarken : 8;

    if(colorInput) colorInput.value = savedBase;
    if(darkenRange) { darkenRange.value = String(darken); if(darkenVal) darkenVal.textContent = `${darken}%`; }

    // apply initial color (this will override CSS --card)
    applyCustomColor(savedBase, darken);
  }

  // palette event listeners
  if(themeToggle){
    themeToggle.addEventListener('click', (e)=> { e.stopPropagation(); togglePalette(); });
  }
  // clicking outside palette closes it
  document.addEventListener('click', (e) => {
    if(!colorPalette) return;
    if(colorPalette.getAttribute('aria-hidden') === 'false'){
      // if click is inside palette or the opener, keep open
      if(colorPalette.contains(e.target) || themeToggle.contains(e.target)) return;
      closePalette();
    }
  });

  // keyboard: Esc closes
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closePalette(); });

  // color input change — realtime
  if(colorInput){
    colorInput.addEventListener('input', (e) => {
      const base = e.target.value;
      const darken = Number(darkenRange ? darkenRange.value : 8);
      applyCustomColor(base, darken);
      localStorage.setItem('user-base-color', base);
      localStorage.setItem('user-darken-pct', String(darken));
    });
  }
  // darken slider change
  if(darkenRange){
    darkenRange.addEventListener('input', (e) => {
      const darken = Number(e.target.value);
      if(darkenVal) darkenVal.textContent = `${darken}%`;
      const base = colorInput ? colorInput.value : (localStorage.getItem('user-base-color') || getComputedStyle(document.documentElement).getPropertyValue('--card-dark').trim());
      applyCustomColor(base, darken);
      localStorage.setItem('user-base-color', base);
      localStorage.setItem('user-darken-pct', String(darken));
    });
  }
  // reset button
  if(paletteReset){
    paletteReset.addEventListener('click', (e) => {
      resetCustomColor();
      // set inputs back to default
      const defaultBase = getComputedStyle(document.documentElement).getPropertyValue('--card-dark').trim() || '#0f1520';
      if(colorInput) colorInput.value = defaultBase;
      if(darkenRange){ darkenRange.value = '8'; if(darkenVal) darkenVal.textContent = '8%'; }
      closePalette();
    });
  }
  if(paletteClose){
    paletteClose.addEventListener('click', () => closePalette());
  }

  /* ---------- Utility: sanitize hex from CSS variable format if needed ---------- */
  function normalizeHex(hex){
    if(!hex) return '#0f1520';
    hex = hex.trim();
    // css variables might be in rgb() format; convert if needed
    if(hex.startsWith('rgb')) {
      const m = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if(m) return rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    if(/^#[0-9a-f]{3}$/i.test(hex) || /^#[0-9a-f]{6}$/i.test(hex)) return hex;
    // fallback
    return '#0f1520';
  }

  /* Initialize palette values (must run early) */
  initPaletteState();

  /* ---------- The rest of the app (chapters, tippy, image viewer, nav) ---------- */
  // For clarity / safety we'll continue with the consolidated features:
  // - load chapters.json, support "done" flag
  // - slide-out chapters list
  // - tippy with preloading of banner images
  // - image viewer with click-to-open, LMB to zoom, drag while zoomed
  // - top/bottom nav with the 1s-hide behavior previously implemented

  /* ---------- Helper functions for chapters/navigation ---------- */
  function isDoneEntry(entry) { if(!entry) return false; return entry.done !== false; }
  function findPrevDoneIndex(fromIndex){ for(let i = (fromIndex === undefined ? currentIndex - 1 : fromIndex); i >= 0; i--) if(isDoneEntry(chapters[i])) return i; return -1; }
  function findNextDoneIndex(fromIndex){ for(let i = (fromIndex === undefined ? currentIndex + 1 : fromIndex); i < chapters.length; i++) if(isDoneEntry(chapters[i])) return i; return -1; }
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
    } else { [bottomPrev, topPrev].forEach(btn => { if(btn){ btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }}); }

    if(!nextDisabled){
      const n = chapters[nextIndex];
      [bottomNext, topNext].forEach(btn => { if(btn){ btn.dataset.index = nextIndex; btn.dataset.title = n.title || ''; }});
    } else { [bottomNext, topNext].forEach(btn => { if(btn){ btn.removeAttribute('data-index'); btn.removeAttribute('data-title'); }}); }

    refreshNavTippies();
  }

  function goToChapter(index){
    if(!chapters || index < 0 || index >= chapters.length) return;
    if(!isDoneEntry(chapters[index])) return;
    currentIndex = index;
    const c = chapters[index];
    loadChapter(c.file, c.title);
    updateNavButtons();
    // save last-chapter for reload restoration
    try{ localStorage.setItem('last-chapter-file', c.file); }catch(e){}
    // after navigating, ensure top nav visible immediately when at top
    window.scrollTo({ top: 0, behavior: 'auto' });
    if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
    closeChapters();
  }

  if(bottomPrev) bottomPrev.addEventListener('click', ()=>{ const i = Number(bottomPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(bottomNext) bottomNext.addEventListener('click', ()=>{ const i = Number(bottomNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topPrev) topPrev.addEventListener('click', ()=>{ const i = Number(topPrev.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });
  if(topNext) topNext.addEventListener('click', ()=>{ const i = Number(topNext.dataset.index); if(!Number.isNaN(i)) goToChapter(i); });

  document.addEventListener('keydown', (e)=> {
    const active = document.activeElement;
    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if(e.key === 'ArrowLeft'){ const prev = findPrevDoneIndex(); if(prev !== -1) goToChapter(prev); }
    if(e.key === 'ArrowRight'){ const next = findNextDoneIndex(); if(next !== -1) goToChapter(next); }
  });

  /* ---------- Load chapters.json and build list ---------- */
  async function loadChapters(){
    chapterBodyEl.textContent = 'Загрузка...';
    try {
      const res = await fetch('chapters.json', { cache: 'no-store' });
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
        if(!isDoneEntry(c)){ a.classList.add('undone'); } else {
          a.addEventListener('click', (e)=>{ e.preventDefault(); goToChapter(i); closeChapters(); });
        }
        li.appendChild(a);
        chaptersListEl.appendChild(li);
      });

      // restore last-chapter-file if present
      const saved = localStorage.getItem('last-chapter-file');
      if(saved){
        const idx = chapters.findIndex(ch => ch && ch.file === saved && isDoneEntry(ch));
        if(idx !== -1){ goToChapter(idx); return; }
      }

      const first = findFirstDoneIndex();
      if(first !== -1) goToChapter(first);
      else { chapterBodyEl.textContent = 'В репозитории нет доступных (done) глав.'; updateNavButtons(); }
    } catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки chapters.json: ' + err.message;
      console.error('loadChapters error:', err);
      [bottomPrev, bottomNext, topPrev, topNext].forEach(b => { if(b) b.disabled = true; });
    }
  }

  /* ---------- Load a chapter (and restore scroll on reload only) ---------- */
  async function loadChapter(filename, title){
    chapterTitleEl.textContent = title || '';
    chapterBodyEl.textContent = 'Загрузка главы...';
    try {
      const res = await fetch('chapters/' + filename, { cache: 'no-store' });
      if(!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + filename);
      const md = await res.text();
      lastChapterFile = filename;
      const html = (window.marked) ? marked.parse(md) : '<p>Ошибка: библиотека marked не загружена.</p>';
      chapterBodyEl.innerHTML = html;

      preloadTooltipImages();
      initGlossTippy();
      bindImagesToViewer();
      updateNavButtons();

      // restore scroll only if there is a sessionStorage entry (meaning page was reloaded)
      try {
        const key = 'scroll:' + filename;
        const v = sessionStorage.getItem(key);
        if(v !== null){
          const scrollVal = Number(v) || 0;
          requestAnimationFrame(()=>{ requestAnimationFrame(()=> {
            window.scrollTo({ top: scrollVal, behavior: 'auto' });
            try{ sessionStorage.removeItem(key); }catch(e){}
            if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
          });});
        } else {
          // ensure top nav is visible immediately if at top
          if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
        }
      } catch(e) {
        if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate();
      }

    } catch(err){
      chapterBodyEl.textContent = 'Ошибка загрузки главы: ' + err.message;
      console.error('loadChapter error:', err);
    }
  }

  /* ---------- Image resolution/test & preloading for tippy ---------- */
  function testImageUrl(url, timeout = 3000){
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const onLoad = () => { if(done) return; done = true; cleanup(); resolve(true); };
      const onErr = () => { if(done) return; done = true; cleanup(); resolve(false); };
      const cleanup = () => { img.onload = img.onerror = null; clearTimeout(timer); };
      img.onload = onLoad; img.onerror = onErr; img.src = url;
      const timer = setTimeout(()=>{ if(done) return; done = true; cleanup(); resolve(false); }, timeout);
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
    if(lastChapterFile){ bases.push(window.location.origin + '/' + lastChapterFile); const parts = lastChapterFile.split('/'); parts.pop(); const parent = parts.join('/'); if(parent) bases.push(window.location.origin + '/' + parent + '/'); }
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

  async function preloadTooltipImages(){
    if(!chapterBodyEl) return;
    const glossEls = Array.from(chapterBodyEl.querySelectorAll('.gloss'));
    if(!glossEls.length) return;

    for(const el of glossEls){
      const dataImg = el.getAttribute('data-img');
      if(!dataImg) continue;
      if(resolvedUrlCache.has(dataImg) && resolvedUrlCache.get(dataImg) === null) continue;

      try {
        const resolved = await resolveTooltipImage(dataImg);
        if(resolved){
          if(preloadedImgCache.has(resolved)) continue;
          const pimg = new Image();
          pimg.crossOrigin = 'anonymous';
          pimg.decoding = 'async';
          preloadedImgCache.set(resolved, pimg);
          pimg.onload = () => { /* preloaded */ };
          pimg.onerror = () => { preloadedImgCache.delete(resolved); };
          pimg.src = resolved;
        }
      } catch(e){}
    }
  }

  // re-preload on visibilitychange (browser may have evicted images)
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && chapterBodyEl){
      const glossEls = Array.from(chapterBodyEl.querySelectorAll('.gloss'));
      glossEls.forEach(async (el) => {
        const dataImg = el.getAttribute('data-img');
        if(!dataImg) return;
        const resolved = resolvedUrlCache.has(dataImg) ? resolvedUrlCache.get(dataImg) : await resolveTooltipImage(dataImg);
        if(resolved && (!preloadedImgCache.has(resolved) || !preloadedImgCache.get(resolved).complete)){
          try {
            const pimg = new Image();
            pimg.crossOrigin = 'anonymous';
            pimg.decoding = 'async';
            preloadedImgCache.set(resolved, pimg);
            pimg.onload = () => {};
            pimg.onerror = () => { preloadedImgCache.delete(resolved); };
            pimg.src = resolved;
          } catch(e){}
        }
      });
    }
  });

  /* ---------- Tippy init for .gloss (banner image + click-to-open viewer) ---------- */
  function initGlossTippy(){
    if(!window.tippy) return;
    document.querySelectorAll('.gloss').forEach(el => { try{ if(el._tippy) el._tippy.destroy(); }catch(e){} });

    tippy('.gloss', {
      allowHTML: true,
      interactive: true,
      delay: [60,80],
      maxWidth: 520,
      placement: 'top',
      offset: [0,8],
      appendTo: () => document.body,
      popperOptions: {
        strategy: 'fixed',
        modifiers: [
          { name: 'computeStyles', options: { adaptive: false } },
          { name: 'preventOverflow', options: { padding: 8, altAxis: true } },
          { name: 'flip', options: { fallbackPlacements: ['bottom','right','left'] } }
        ]
      },
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
            const pimg = new Image();
            pimg.crossOrigin = 'anonymous';
            pimg.decoding = 'async';
            preloadedImgCache.set(resolved, pimg);
            pimg.onload = () => {};
            pimg.onerror = () => { preloadedImgCache.delete(resolved); };
            pimg.src = resolved;
          }

          const imgEl = document.createElement('img');
          imgEl.className = 'tooltip-img';
          imgEl.src = resolved;
          imgEl.alt = imgAlt;
          imgEl.loading = 'eager';
          imgEl.style.cursor = 'pointer';
          imgEl.addEventListener('click', (ev) => {
            ev.stopPropagation();
            try{ openImageViewer(resolved, imgAlt); }catch(e){}
            try{ instance.hide(); }catch(e){}
          });
          imgEl.addEventListener('load', () => {
            try{ if(instance.popperInstance && typeof instance.popperInstance.update === 'function') instance.popperInstance.update(); else if(typeof instance.update === 'function') instance.update(); }catch(e){}
          });
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

  /* ---------- Nav tippies ---------- */
  function refreshNavTippies(){
    if(!window.tippy) return;
    [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if(!btn) return; try{ if(btn._tippy) btn._tippy.destroy(); }catch(e){} });
    if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8], appendTo: () => document.body });
    if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8], appendTo: () => document.body });
  }

  /* ---------- Chapters aside slide-in/out ---------- */
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

  /* ---------- Top nav logic (1s hide delay, immediate show at top) ---------- */
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
  const HIDE_DELAY_MS = 1000;

  function clearHideTimer(){ if(hideDelayTimer){ clearTimeout(hideDelayTimer); hideDelayTimer = null; } }
  function bottomNavIsVisible(){ if(!bottomNav) return false; const r = bottomNav.getBoundingClientRect(); return (r.top < window.innerHeight) && (r.bottom > 0); }

  function showTopNavImmediate(){
    if(bottomNavIsVisible()){ hideTopNavImmediate(); return; }
    if(!topNav) return;
    topNav.classList.add('visible-top');
    topNav.setAttribute('aria-hidden', 'false');
    clearHideTimer();
  }
  function hideTopNavImmediate(){
    if(!topNav) return;
    topNav.classList.remove('visible-top');
    topNav.setAttribute('aria-hidden', 'true');
    clearHideTimer();
  }
  function scheduleHideTopNav(){
    if(hideDelayTimer) return;
    hideDelayTimer = setTimeout(()=>{ if(!bottomNavIsVisible()) hideTopNavImmediate(); hideDelayTimer = null; }, HIDE_DELAY_MS);
  }

  function onScrollCheck(){
    const curY = window.scrollY;
    const scrollingUp = curY < lastScrollY;
    const atTop = curY <= 10;

    if(bottomNavIsVisible()){
      hideTopNavImmediate();
      clearHideTimer();
    } else if(atTop || scrollingUp){
      clearHideTimer();
      showTopNavImmediate();
    } else {
      scheduleHideTopNav();
    }
    lastScrollY = curY;
  }

  window.addEventListener('scroll', ()=>{ if(scheduled) return; scheduled = true; requestAnimationFrame(()=>{ onScrollCheck(); scheduled = false; }); }, { passive:true });
  window.addEventListener('resize', ()=>{ positionTopNav(); onScrollCheck(); });

  const observer = new IntersectionObserver((entries)=>{ const anyVisible = entries.some(en => en.isIntersecting); if(anyVisible) hideTopNavImmediate(); }, { root:null, threshold:0.01 });
  if(bottomNav) observer.observe(bottomNav);

  function initialTopNavSetup(){ positionTopNav(); if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); else hideTopNavImmediate(); }
  initialTopNavSetup();
  setTimeout(initialTopNavSetup, 80);

  /* ---------- Image viewer ---------- */
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

  function openImageViewer(src, alt=''){
    overlayImg.src = src; overlayImg.alt = alt || '';
    const marginPx = 40;
    overlayImg.style.maxWidth = `calc(100vw - ${marginPx}px)`;
    overlayImg.style.maxHeight = `calc(100vh - ${Math.round(marginPx * 1.5)}px)`;
    overlay.classList.add('visible');
    overlay.style.display = 'flex';
    isZoomed = false; imgPos = { x:0, y:0 };
    overlayImg.style.transform = `translate(0px, 0px) scale(1)`; overlayImg.classList.remove('zoomed');
    overlay.style.cursor = 'default';
    document.body.style.overflow = 'hidden';
    const viewer = overlay.querySelector('.viewer'); if(viewer){ viewer.scrollTop = 0; viewer.scrollLeft = 0; }
  }

  function closeImageViewer(){
    overlay.classList.remove('visible'); overlay.style.display = 'none';
    overlayImg.src = ''; isZoomed = false; pointerDown = false; dragMoved = false; suppressClick = false;
    document.body.style.overflow = ''; overlayImg.style.maxWidth = ''; overlayImg.style.maxHeight = '';
  }

  function applyImageTransform(){
    const scale = isZoomed ? 2 : 1;
    overlayImg.style.transform = `translate(${imgPos.x}px, ${imgPos.y}px) scale(${scale})`;
    if(isZoomed) overlayImg.classList.add('zoomed'); else overlayImg.classList.remove('zoomed');
  }

  overlayImg.addEventListener('click', (ev)=> {
    if(suppressClick){ suppressClick = false; return; }
    isZoomed = !isZoomed;
    if(!isZoomed) imgPos = { x:0, y:0 };
    applyImageTransform();
  });

  overlayImg.addEventListener('mousedown', (ev)=> {
    if(!isZoomed) return;
    ev.preventDefault(); pointerDown = true; dragMoved = false; pointerStart = { x: ev.clientX, y: ev.clientY }; overlayImg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (ev)=> {
    if(!pointerDown || !isZoomed) return;
    const dx = ev.clientX - pointerStart.x; const dy = ev.clientY - pointerStart.y;
    if(!dragMoved && (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD)) dragMoved = true;
    if(dragMoved){ pointerStart = { x: ev.clientX, y: ev.clientY }; imgPos.x += dx; imgPos.y += dy; applyImageTransform(); }
  });

  window.addEventListener('mouseup', (ev)=> {
    if(pointerDown && dragMoved){ suppressClick = true; setTimeout(()=>{ suppressClick = false; }, 0); }
    pointerDown = false; overlayImg.style.cursor = isZoomed ? 'grab' : 'zoom-in';
  });

  overlay.addEventListener('click', (ev)=> { if(ev.target === overlay) closeImageViewer(); });
  window.addEventListener('keydown', (ev)=> { if(ev.key === 'Escape' && overlay.classList.contains('visible')) closeImageViewer(); });

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

  /* ---------- Persist scroll on unload (sessionStorage) ---------- */
  window.addEventListener('beforeunload', () => {
    try {
      if(currentIndex >= 0 && chapters[currentIndex] && chapters[currentIndex].file){
        const key = 'scroll:' + chapters[currentIndex].file;
        sessionStorage.setItem(key, String(window.scrollY || 0));
      }
    } catch(e){}
  });

  /* ---------- small helpers ---------- */
  function refreshNavTippies(){ if(!window.tippy) return; [bottomPrev, bottomNext, topPrev, topNext].forEach(btn => { if(!btn) return; try{ if(btn._tippy) btn._tippy.destroy(); }catch(e){} }); if(bottomPrev) tippy(bottomPrev, { content: () => bottomPrev.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8], appendTo: () => document.body }); if(bottomNext) tippy(bottomNext, { content: () => bottomNext.dataset.title || '', placement: 'top', delay: [80,40], offset: [0,8], appendTo: () => document.body }); if(topPrev) tippy(topPrev, { content: () => topPrev.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8], appendTo: () => document.body }); if(topNext) tippy(topNext, { content: () => topNext.dataset.title || '', placement: 'bottom', delay: [80,40], offset: [0,8], appendTo: () => document.body }); }

  /* ---------- Start ---------- */
  loadChapters();
  updateNavButtons();
  setTimeout(()=>{ positionTopNav(); if(window.scrollY <= 10 && !bottomNavIsVisible()) showTopNavImmediate(); }, 120);

});
