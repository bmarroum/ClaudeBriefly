'use strict';
// ═══════════════════════════════════════════════════════════════════
//  BRIEFLY INTELLIGENCE v5.0 — MENA & Ukraine NGO Safety Platform
// ═══════════════════════════════════════════════════════════════════
const API = 'https://claudebriefly.onrender.com';

// ── State ─────────────────────────────────────────────────────────
let currentTab      = 'news';
let currentRegion   = 'Middle East & Africa';
let currentBriefTopic = '';
let showCitations   = true;
let showAiBadge     = true;
let marketsLoaded   = false;
let leafletMap      = null;
let advisoryActive  = new Set();
let chatHistory     = [];

// ── Cache ─────────────────────────────────────────────────────────
const CACHE = {};
const TTL = { news: 5*60000, brief: 30*60000, markets: 10*60000, adv: 15*60000, air: 10*60000 };

function cacheGet(k, ttl) {
  const e = CACHE[k];
  if (!e) return null;
  if (Date.now() - e.ts > ttl) { delete CACHE[k]; return null; }
  return e.data;
}
function cacheSet(k, d) { CACHE[k] = { data: d, ts: Date.now() }; }

// ── localStorage helper ───────────────────────────────────────────
const LS = {
  get(k, def) { try { const v = localStorage.getItem('briefly_'+k); return v!=null ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v)  { try { localStorage.setItem('briefly_'+k, JSON.stringify(v)); } catch {} },
};

// ── Fetch with retry ──────────────────────────────────────────────
async function apiFetch(path, opts, cKey, ttl) {
  if (cKey) { const c = cacheGet(cKey, ttl||TTL.news); if (c) return c; }
  const merged = { method:'POST', headers:{'Content-Type':'application/json'}, ...opts };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(API + path, merged);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (cKey) cacheSet(cKey, d);
      return d;
    } catch(e) {
      if (i < 2) await new Promise(res => setTimeout(res, 8000));
      else throw e;
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function cleanBody(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g,' ').replace(/https?:\/\/\S+/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#\d+;/g,'')
    .replace(/\s+/g,' ').trim().slice(0,200);
}
function fmtDate(str) {
  try {
    const d = new Date(str);
    if (isNaN(d)) return '';
    const now = new Date();
    const diff = (now - d) / 60000;
    if (diff < 60) return Math.round(diff) + 'm ago';
    if (diff < 1440) return Math.round(diff/60) + 'h ago';
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  } catch { return ''; }
}

// ── Tab switching ─────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('tab-'+tab);
  const nb = document.getElementById('nav-'+tab);
  if (el) el.classList.add('active');
  if (nb) nb.classList.add('active');
  currentTab = tab;
  LS.set('lastTab', tab);

  if (tab === 'news')        loadNews(currentRegion);
  else if (tab === 'airspace')   initAirspaceTab();
  else if (tab === 'markets' && !marketsLoaded) loadMarkets();
  else if (tab === 'settings')   initSettingsUI();
}

function forceRefresh() {
  Object.keys(CACHE).forEach(k => delete CACHE[k]);
  if (currentTab === 'news') loadNews(currentRegion);
  else if (currentTab === 'markets') { marketsLoaded=false; loadMarkets(); }
  else if (currentTab === 'airspace') loadAirspaceNews();
  showToast('Refreshed', 'success');
}

// ═══════════════════════════════════════════════════════════════════
//  NEWS
// ═══════════════════════════════════════════════════════════════════
function selectRegion(btn, region) {
  document.querySelectorAll('#regionPills .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentRegion = region;
  LS.set('lastRegion', region);
  loadNews(region);
}

async function loadNews(region, search) {
  currentRegion = region || currentRegion;
  const el = document.getElementById('newsContent');
  el.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Loading headlines…</div>';
  const cKey = search ? 'search_'+search : 'news_'+currentRegion;
  try {
    const data = await apiFetch('/api/news',
      { body: JSON.stringify({ topic: currentRegion, search: search||undefined }) },
      cKey, TTL.news);
    el._data = data; el._search = search||null;
    renderNews(data, el, search||null);
  } catch(e) {
    el.innerHTML = `<div class="error-card">⚠ Failed to load. Backend may be warming up.
      <button class="retry-btn" onclick="loadNews(currentRegion)">Retry</button></div>`;
  }
}

function doNewsSearch() {
  const q = document.getElementById('newsSearchInput')?.value?.trim();
  if (!q) { loadNews(currentRegion); return; }
  loadNews(null, q);
}

function renderNews(data, el, searchQuery) {
  const items = (data.items || []).sort((a,b) => new Date(b.pubDate||0) - new Date(a.pubDate||0));

  let h = `<div class="news-card">`;
  h += `<div class="news-card-header">`;
  h += `<div class="news-headline">${esc(data.headline||'Headlines')}</div>`;
  h += `<button class="news-refresh-btn" onclick="delete CACHE['news_'+currentRegion];loadNews(currentRegion)" title="Refresh">↺</button>`;
  h += `</div>`;
  if (data.summary) h += `<div class="news-summary">${esc(data.summary)}</div>`;
  h += `<div class="news-count">${items.length} headlines</div>`;

  items.forEach(item => {
    const body = cleanBody(item.body);
    const href = item.link ? ` href="${esc(item.link)}" target="_blank" rel="noopener"` : '';
    let title = esc(item.title);
    if (searchQuery) title = highlight(title, searchQuery);

    h += `<div class="news-item">`;
    h += `<div class="news-item-body">`;
    h += `<a class="news-item-title"${href}>${title}</a>`;
    if (body) h += `<div class="news-item-body-text">${esc(body)}</div>`;
    h += `<div class="news-item-meta">`;
    if (item.sources) h += `<span class="news-source">${esc(item.sources)}</span>`;
    if (item.pubDate) h += `<span class="news-date">${fmtDate(item.pubDate)}</span>`;
    if (item.isLive) h += `<span class="live-badge">● Live</span>`;
    h += `</div></div></div>`;
  });

  h += `</div>`;
  el.innerHTML = h;
}

function highlight(text, q) {
  const terms = q.trim().split(/\s+/).filter(t => t.length > 2);
  let r = text;
  terms.forEach(t => {
    r = r.replace(new RegExp('('+t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')', 'gi'),
      '<mark class="hl">$1</mark>');
  });
  return r;
}

// ═══════════════════════════════════════════════════════════════════
//  BRIEF
// ═══════════════════════════════════════════════════════════════════
const THREAT_ICONS = { CRITICAL:'🔴', HIGH:'🟠', ELEVATED:'🟡', MODERATE:'🔵', LOW:'🟢' };

function quickBrief(topic) {
  document.getElementById('briefSearchInput').value = topic;
  generateBrief();
}

function generateBriefForce() {
  window._briefForce = true;
  generateBrief().finally(() => { window._briefForce = false; });
}

async function generateBrief() {
  const q = document.getElementById('briefSearchInput').value.trim() || currentBriefTopic;
  if (!q) { showToast('Enter a topic first', 'warning'); return; }
  currentBriefTopic = q; LS.set('lastBrief', q);
  document.getElementById('briefTitleText').textContent = q;

  const el = document.getElementById('briefContent');
  const stages = [
    { icon:'🔍', text:'Searching live sources…',     sub:'Google News + Reuters RSS feeds' },
    { icon:'📡', text:'Gathering intelligence…',     sub:'Gemini grounding + multi-source analysis' },
    { icon:'🧠', text:'Synthesizing assessment…',    sub:'Cross-referencing and building brief' },
    { icon:'📋', text:'Finalizing brief…',           sub:'Structuring threat levels and actors' },
  ];
  let si = 0;
  const renderStage = s => {
    el.innerHTML = `<div class="brief-loading">
      <div class="brief-load-icon">${s.icon}</div>
      <div class="brief-load-text">${s.text}</div>
      <div class="brief-load-sub">${s.sub}</div>
      <div class="stage-dots">${stages.map((_,i)=>`<div class="stage-dot${i===si?' active':''}"></div>`).join('')}</div>
    </div>`;
  };
  renderStage(stages[0]);
  const timer = setInterval(() => { si = Math.min(si+1, stages.length-1); renderStage(stages[si]); }, 7000);

  const btn = document.getElementById('briefGenerateBtn');
  if (btn) { btn.disabled=true; btn.textContent='⏳ Analyzing…'; }

  try {
    const data = await apiFetch('/api/briefing',
      { body: JSON.stringify({ topic: q, force: !!window._briefForce }) }, null);
    clearInterval(timer);
    const a = data.analysis || {};
    window._lastBriefData = { analysis: a, topic: q, liveHeadlines: data.liveHeadlines||[] };
    renderBrief(a, q, data.liveHeadlines||[]);
  } catch(e) {
    clearInterval(timer);
    el.innerHTML = `<div class="error-card">⚠ Failed to generate brief: ${esc(e.message)}
      <button class="retry-btn" onclick="generateBrief()">Retry</button></div>`;
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='⚡ Generate'; }
  }
}

function renderBrief(a, topic, headlines) {
  const el = document.getElementById('briefContent');
  const ts = new Date().toLocaleString('en-US',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC';
  const threat = (a.threat_level||'MODERATE').toUpperCase();
  const conf = a.confidence || 75;
  const tIcon = THREAT_ICONS[threat]||'🔵';

  let h = '';

  // Action bar
  h += `<div class="brief-actions">
    <button class="brief-act-btn" onclick="copyBrief()">📋 Copy</button>
    <button class="brief-act-btn" onclick="exportBriefPDF()">📥 PDF</button>
    ${showAiBadge ? '<span class="ai-badge">🤖 AI Analysis</span>' : ''}
  </div>`;

  // Meta
  h += `<div class="brief-meta">
    <span>📅 ${ts}</span>
    <span>🔐 INTEL BRIEF</span>
    ${headlines.length ? '<span class="live-badge">● Live Context</span>' : ''}
  </div>`;

  // Threat banner
  h += `<div class="threat-banner threat-${threat}">
    <div class="threat-left">
      <span class="threat-icon-big">${tIcon}</span>
      <div>
        <div class="threat-label">Threat Assessment</div>
        <div class="threat-value">${threat}</div>
      </div>
    </div>
    <div class="threat-right">
      <div class="conf-label">Confidence: ${conf}%</div>
      <div class="conf-bar"><div class="conf-fill" style="width:${conf}%"></div></div>
      ${a.threat_level_reason ? `<div class="threat-reason">${esc(a.threat_level_reason)}</div>` : ''}
    </div>
  </div>`;

  // Main grid
  h += `<div class="brief-grid">`;

  // Left column — narrative sections
  h += `<div class="brief-main">`;
  const sections = [
    ['📌','Executive Summary','executive'],
    ['📡','Current Situation','situation'],
    ['🌐','Geopolitical Analysis','geopolitical'],
    ['🏥','Humanitarian','humanitarian'],
    ['🎯','Strategic Outlook','strategic'],
  ];
  sections.forEach(([icon, title, key]) => {
    if (!a[key]) return;
    h += `<div class="brief-section">
      <div class="brief-sec-hdr"><span>${icon}</span><span>${title}</span></div>
      <div class="brief-sec-body">${esc(a[key])}</div>
    </div>`;
  });

  // Sources
  if (showCitations && a.sources?.length) {
    h += `<div class="brief-section">
      <div class="brief-sec-hdr"><span>📎</span><span>Verify Sources</span></div>
      <div class="source-links">`;
    a.sources.forEach(src => {
      h += `<a href="${esc(src.url)}" target="_blank" rel="noopener" class="source-link">→ ${esc(src.name)}</a>`;
    });
    h += `</div></div>`;
  }
  h += `</div>`; // end main

  // Right column — structured data
  h += `<div class="brief-side">`;

  // Key Actors
  if (a.key_actors?.length) {
    h += `<div class="brief-section">
      <div class="brief-sec-hdr"><span>👤</span><span>Key Actors</span></div>
      <div class="actor-list">`;
    a.key_actors.slice(0,5).forEach(ac => {
      h += `<div class="actor-card">
        <div class="actor-name">${esc(ac.name||'')}</div>
        <div class="actor-role">${esc(ac.role||'')}</div>
        ${ac.stance ? `<div class="actor-stance">${esc(ac.stance)}</div>` : ''}
      </div>`;
    });
    h += `</div></div>`;
  }

  // Timeline
  if (a.timeline?.length) {
    h += `<div class="brief-section">
      <div class="brief-sec-hdr"><span>🕐</span><span>Timeline</span></div>
      <div class="timeline-list">`;
    a.timeline.slice(0,6).forEach(ev => {
      h += `<div class="tl-item">
        <div class="tl-date">${esc(ev.date||'')}</div>
        <div class="tl-event">${esc(ev.event||'')}</div>
      </div>`;
    });
    h += `</div></div>`;
  }

  // Key Risks
  if (a.key_risks?.length) {
    h += `<div class="brief-section">
      <div class="brief-sec-hdr"><span>⚠️</span><span>Key Risks</span></div>
      <div class="risk-list">`;
    a.key_risks.forEach(r => { h += `<div class="risk-item">${esc(r)}</div>`; });
    h += `</div></div>`;
  }

  // Watch Points
  if (a.watch_points?.length) {
    h += `<div class="brief-section">
      <div class="brief-sec-hdr"><span>👁</span><span>Watch Points</span></div>
      <div class="watch-list">`;
    a.watch_points.forEach(w => { h += `<div class="watch-item">${esc(w)}</div>`; });
    h += `</div></div>`;
  }

  // Live Headlines
  if (headlines.length) {
    h += `<div class="brief-section">
      <div class="brief-sec-hdr"><span>📰</span><span>Live Headlines <span class="live-badge">● Live</span></span></div>
      <div class="live-hl-list">`;
    headlines.slice(0,6).forEach(hl => {
      const lk = hl.link ? `href="${esc(hl.link)}" target="_blank" rel="noopener"` : '';
      h += `<div class="live-hl"><a ${lk}>${esc(hl.title)}</a></div>`;
    });
    h += `</div></div>`;
  }

  // Related topics
  if (a.related_topics?.length) {
    h += `<div class="brief-section">
      <div class="brief-sec-hdr"><span>🔗</span><span>Related Topics</span></div>
      <div class="related-chips">`;
    a.related_topics.forEach(t => {
      h += `<button class="related-chip" onclick="quickBrief('${t.replace(/'/g,"\\'")}');">${esc(t)}</button>`;
    });
    h += `</div></div>`;
  }

  h += `</div>`; // end side
  h += `</div>`; // end grid
  el.innerHTML = h;
}

function copyBrief() {
  const sections = document.querySelectorAll('#briefContent .brief-section');
  let text = (currentBriefTopic||'Intelligence Brief').toUpperCase() + ' — BRIEFLY INTEL BRIEF\n' + '═'.repeat(60) + '\n';
  text += 'Generated: ' + new Date().toUTCString() + '\n\n';
  sections.forEach(s => {
    const title = s.querySelector('.brief-sec-hdr span:last-child');
    const body  = s.querySelector('.brief-sec-body');
    if (title && body) text += title.textContent.trim() + '\n' + '─'.repeat(40) + '\n' + body.textContent.trim() + '\n\n';
  });
  navigator.clipboard.writeText(text).then(() => showToast('Brief copied', 'success'));
}

async function exportBriefPDF() {
  const btn = document.querySelector('.brief-actions .brief-act-btn:nth-child(2)');
  if (btn) { btn.disabled=true; btn.textContent='⏳ Generating…'; }
  try {
    if (!window.jspdf) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const { jsPDF } = window.jspdf;
    const stored = window._lastBriefData;
    if (!stored) throw new Error('No brief loaded');
    const a = stored.analysis, topic = stored.topic || currentBriefTopic;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W=210, M=16, CW=W-M*2; let y=0;

    const np = () => { doc.addPage(); y=20; };
    const chk = n => { if (y+n>278) np(); };
    const txt = (t,x,mw,sz,st,rgb) => {
      doc.setFontSize(sz); doc.setFont('helvetica',st||'normal');
      doc.setTextColor(...(rgb||[20,20,40]));
      const ls = doc.splitTextToSize(String(t||'').replace(/\s+/g,' ').trim(), mw);
      chk(ls.length*sz*0.38+2); doc.text(ls,x,y); y+=ls.length*sz*0.38+2;
    };
    const hdr = (t) => {
      chk(14); doc.setFillColor(200,168,75);
      doc.roundedRect(M,y,CW,8,1.5,1.5,'F');
      doc.setFontSize(8.5); doc.setFont('helvetica','bold'); doc.setTextColor(15,22,35);
      doc.text(t.toUpperCase(), M+5, y+5.8); y+=13;
    };

    // Cover header
    doc.setFillColor(12,18,30); doc.rect(0,0,W,38,'F');
    doc.setFillColor(200,168,75); doc.rect(M,10,1.5,20,'F');
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(200,168,75);
    doc.text('BRIEFLY INTELLIGENCE · MENA & UKRAINE · INTELLIGENCE BRIEF', M+5, 14);
    doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(235,228,210);
    doc.text(topic.toUpperCase().slice(0,40), M+5, 26);
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(120,120,140);
    doc.text(new Date().toUTCString()+'  ·  AI-GENERATED — VERIFY WITH OFFICIAL SOURCES', M+5, 34);
    y=46;

    // Threat bar
    const threat=(a.threat_level||'MODERATE').toUpperCase();
    const tc={CRITICAL:[180,30,30],HIGH:[210,60,40],ELEVATED:[200,110,20],MODERATE:[30,100,170],LOW:[30,140,80]}[threat]||[80,80,80];
    chk(16); doc.setFillColor(...tc);
    doc.roundedRect(M,y,CW,11,2,2,'F');
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text(`THREAT: ${threat}   |   CONFIDENCE: ${a.confidence||'—'}%`, M+4, y+7.5); y+=16;

    const sections=[['Executive Summary','executive'],['Current Situation','situation'],
      ['Geopolitical Analysis','geopolitical'],['Humanitarian','humanitarian'],['Strategic Outlook','strategic']];
    sections.forEach(([t,k]) => { if(a[k]){hdr(t); txt(a[k],M,CW,9.5); y+=4;} });

    if (a.key_actors?.length) {
      hdr('Key Actors');
      a.key_actors.slice(0,6).forEach(ac => {
        chk(10); txt(ac.name||'',M+2,CW-4,9,'bold');
        if(ac.role) txt(ac.role,M+2,CW-4,8,'italic',[100,80,40]);
        y+=2;
      });
    }
    if (a.key_risks?.length) { hdr('Key Risks'); a.key_risks.forEach(r=>{chk(8);txt('• '+r,M+2,CW-6,8.5);y+=1;}); }
    if (a.watch_points?.length) { hdr('Watch Points'); a.watch_points.forEach(w=>{chk(8);txt('• '+w,M+2,CW-6,8.5);y+=1;}); }

    // Page footers
    const n=doc.getNumberOfPages();
    for(let i=1;i<=n;i++){
      doc.setPage(i); doc.setFillColor(235,230,220); doc.rect(0,283,W,14,'F');
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(120,110,90);
      doc.text('BRIEFLY INTELLIGENCE · MENA & UKRAINE · AI-GENERATED — VERIFY WITH OFFICIAL SOURCES', M, 290);
      doc.text('Page '+i+' of '+n, W-M, 290,{align:'right'});
    }
    doc.save('Briefly_'+topic.replace(/[^a-z0-9]/gi,'_').slice(0,30)+'_'+new Date().toISOString().slice(0,10)+'.pdf');
  } catch(e) {
    showToast('PDF failed: '+e.message, 'error');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='📥 PDF'; }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  AIRSPACE — FlightRadar24 news feed for MENA & Ukraine
// ═══════════════════════════════════════════════════════════════════
function initAirspaceTab() {
  initMap();
  loadAirspaceNews();
}

function initMap() {
  const container = document.getElementById('airspaceMap');
  if (!container || leafletMap) {
    if (leafletMap) setTimeout(() => leafletMap.invalidateSize(), 200);
    return;
  }
  container.style.height = '240px';
  try {
    leafletMap = L.map('airspaceMap', { zoomControl:true, scrollWheelZoom:false })
      .setView([28, 38], 4);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution:'© OpenStreetMap © CARTO', subdomains:'abcd', maxZoom:18
    }).addTo(leafletMap);
    // Add region markers
    const markers = [
      [31.9, 35.9, '🇵🇸 Gaza/Israel'], [33.9, 35.5, '🇱🇧 Lebanon'],
      [34.8, 38.9, '🇸🇾 Syria'],       [33.3, 44.4, '🇮🇶 Iraq'],
      [48.4, 31.2, '🇺🇦 Ukraine'],     [15.4, 32.5, '🇸🇩 Sudan'],
      [15.3, 44.2, '🇾🇪 Yemen'],       [29.3, 42.7, '🇸🇦 Saudi Arabia'],
    ];
    markers.forEach(([lat,lng,label]) => {
      L.marker([lat,lng]).addTo(leafletMap).bindPopup(label);
    });
    setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 300);
  } catch(e) { console.warn('Map init:', e); }
}

async function loadAirspaceNews() {
  const el = document.getElementById('airspaceContent');
  el.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Loading FlightRadar24 aviation news…</div>';
  try {
    const data = await apiFetch('/api/news',
      { body: JSON.stringify({ topic: 'Middle East Ukraine airspace aviation FlightRadar24 flight ban', search: 'airspace NOTAM aviation MENA Ukraine flight restriction' }) },
      'airspace_news', TTL.air);
    renderAirspaceNews(data);
  } catch(e) {
    el.innerHTML = `<div class="error-card">⚠ Failed to load airspace news.
      <button class="retry-btn" onclick="loadAirspaceNews()">Retry</button></div>`;
  }
}

function renderAirspaceNews(data, countryLabel) {
  const el = document.getElementById('airspaceContent');
  const items = data.items || [];

  if (!items.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">✈️</div><div class="empty-title">No airspace alerts found</div></div>';
    return;
  }

  let h = '<div class="airspace-news-list">';
  items.slice(0,20).forEach(item => {
    const body = cleanBody(item.body);
    const href = item.link ? ` href="${esc(item.link)}" target="_blank" rel="noopener"` : '';
    h += `<div class="airspace-news-item">
      <div class="airspace-news-icon">✈️</div>
      <div class="airspace-news-body">
        <a class="airspace-news-title"${href}>${esc(item.title)}</a>
        ${body ? `<div class="airspace-news-desc">${esc(body)}</div>` : ''}
        <div class="airspace-news-meta">
          ${item.sources ? `<span>${esc(item.sources)}</span>` : ''}
          ${item.pubDate ? `<span>${fmtDate(item.pubDate)}</span>` : ''}
          ${item.isLive ? '<span class="live-badge">● Live</span>' : ''}
        </div>
      </div>
    </div>`;
  });
  h += '</div>';

  // FR24 official link
  h += `<div class="airspace-source-note">
    ✈️ For live flight tracking:
    <a href="https://www.flightradar24.com/data/airspaces" target="_blank" rel="noopener">FlightRadar24 Airspaces ↗</a>
    &nbsp;·&nbsp;
    <a href="https://www.notams.faa.gov/dinsQueryWeb/" target="_blank" rel="noopener">FAA NOTAMs ↗</a>
    &nbsp;·&nbsp;
    <a href="https://eurocontrol.int/" target="_blank" rel="noopener">EUROCONTROL ↗</a>
  </div>`;

  el.innerHTML = h;
}

// ═══════════════════════════════════════════════════════════════════
//  ADVISORIES — MENA & Ukraine country chips
// ═══════════════════════════════════════════════════════════════════
function toggleAdvisory(btn, country) {
  if (advisoryActive.has(country)) {
    advisoryActive.delete(country);
    btn.classList.remove('active');
    const card = document.getElementById('adv_'+country.replace(/\s+/g,'_'));
    if (card) card.remove();
    if (!advisoryActive.size) showAdvisoryEmpty();
  } else {
    advisoryActive.add(country);
    btn.classList.add('active');
    loadAdvisoryCountry(country);
  }
}

function showAdvisoryEmpty() {
  document.getElementById('advisoryContent').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🛡️</div>
      <div class="empty-title">Tap a country above</div>
      <div class="empty-sub">Load the latest travel advisory for any MENA country or Ukraine.</div>
    </div>`;
}

async function loadAdvisoryCountry(country) {
  const el = document.getElementById('advisoryContent');
  // Clear empty state if present
  if (el.querySelector('.empty-state')) el.innerHTML = '';

  // Insert skeleton
  const cardId = 'adv_'+country.replace(/\s+/g,'_');
  if (!document.getElementById(cardId)) {
    const div = document.createElement('div');
    div.id = cardId;
    div.innerHTML = `<div class="adv-card-skeleton">
      <div class="skel-line w120"></div>
      <div class="skel-line w100"></div>
      <div class="skel-line w80"></div>
    </div>`;
    el.appendChild(div);
  }

  try {
    const data = await apiFetch('/api/advisories',
      { body: JSON.stringify({ country }) }, 'adv_'+country, TTL.adv);
    renderAdvisoryCard(country, data);
  } catch(e) {
    const div = document.getElementById(cardId);
    if (div) div.innerHTML = `<div class="adv-card error-card">⚠ Failed to load ${esc(country)}: ${esc(e.message)}</div>`;
  }
}

function getFlagEmoji(code) {
  if (!code || code.length !== 2) return '';
  try { return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6-65+c.charCodeAt(0))); }
  catch { return ''; }
}

function removeAdvisoryCountry(country) {
  advisoryActive.delete(country);
  // Deactivate chip
  document.querySelectorAll('#advisoryChips .adv-chip').forEach(btn => {
    const c = btn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (c === country) btn.classList.remove('active');
  });
  const card = document.getElementById('adv_'+country.replace(/\s+/g,'_'));
  if (card) card.remove();
  if (!advisoryActive.size) showAdvisoryEmpty();
}

function riskColor(score) {
  if (score >= 75) return '#e05c5c';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffc107';
  return '#4caf84';
}

function advLevelLabel(level) {
  return {1:'Exercise Normal Caution',2:'Exercise Increased Caution',3:'Reconsider Travel',4:'Do Not Travel'}[parseInt(level)||2]||'Exercise Caution';
}

function renderAdvisoryCard(country, data) {
  const cardId = 'adv_'+country.replace(/\s+/g,'_');
  const wrapper = document.getElementById(cardId);
  if (!wrapper) return;

  const level  = parseInt(data.level || data.advisoryLevel || data.level_number || 2);
  const flag   = data.flag || getFlagEmoji(data.country_code || country.slice(0,2).toUpperCase());
  const code   = (data.country_code || country.slice(0,2)).toLowerCase();
  const label  = advLevelLabel(level);
  const risks  = data.risks || {};

  const levelClass = ['','adv-l1','adv-l2','adv-l3','adv-l4'][level] || 'adv-l2';

  let h = `<div class="adv-card">
    <div class="adv-card-hdr">
      <span class="adv-flag">${flag}</span>
      <div class="adv-hdr-text">
        <div class="adv-country">${esc(country)}</div>
        <div class="adv-level ${levelClass}">Level ${level} — ${esc(label)}</div>
      </div>
      <button class="adv-remove" onclick="removeAdvisoryCountry('${country.replace(/'/g,"\\'")}')">✕</button>
    </div>
    <div class="adv-card-body">`;

  if (data.summary) h += `<div class="adv-summary">${esc(data.summary)}</div>`;

  // Risk bars
  const riskKeys = Object.keys(risks).slice(0,5);
  if (riskKeys.length) {
    h += `<div class="adv-risks">`;
    riskKeys.forEach(k => {
      const score = risks[k]||0;
      const color = riskColor(score);
      h += `<div class="adv-risk-row">
        <div class="adv-risk-label">${esc(k)}</div>
        <div class="adv-risk-bar"><div class="adv-risk-fill" style="width:${score}%;background:${color}"></div></div>
        <div class="adv-risk-score">${score}</div>
      </div>`;
    });
    h += `</div>`;
  }

  // Quick facts
  const facts = [];
  if (data.key_risks?.length)     facts.push(['⚠️ Key Risks', data.key_risks.slice(0,3).join(' · ')]);
  if (data.entry || data.entryRequirements) facts.push(['🛂 Entry', data.entry||data.entryRequirements]);
  if (data.emergency || data.emergencyContact) facts.push(['📞 Emergency', data.emergency||data.emergencyContact]);
  if (facts.length) {
    h += `<div class="adv-facts">`;
    facts.forEach(([label, val]) => {
      h += `<div class="adv-fact"><span class="adv-fact-label">${label}</span><span class="adv-fact-val">${esc(String(val).slice(0,120))}</span></div>`;
    });
    h += `</div>`;
  }

  // Source links
  h += `<div class="adv-sources">
    <a href="https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/${code}-travel-advisory.html" target="_blank" rel="noopener" class="adv-src-btn">🇺🇸 State Dept</a>
    <a href="https://www.gov.uk/foreign-travel-advice/${code}" target="_blank" rel="noopener" class="adv-src-btn">🇬🇧 FCDO</a>
  </div>`;

  h += `</div></div>`;
  wrapper.innerHTML = h;
}

// ═══════════════════════════════════════════════════════════════════
//  MARKETS — Commodities only
// ═══════════════════════════════════════════════════════════════════
const COMMODITIES = {
  id: 'commodities',
  label: 'Essential Commodities',
  symbols: 'GC=F,CL=F,BZ=F,NG=F,ZW=F,ZC=F,SI=F,HG=F',
  names: {
    'GC=F':'Gold',
    'CL=F':'WTI Crude Oil',
    'BZ=F':'Brent Crude Oil',
    'NG=F':'Natural Gas',
    'ZW=F':'Wheat',
    'ZC=F':'Corn',
    'SI=F':'Silver',
    'HG=F':'Copper',
  },
  icons: {
    'GC=F':'🥇', 'CL=F':'🛢️', 'BZ=F':'🛢️', 'NG=F':'🔥',
    'ZW=F':'🌾', 'ZC=F':'🌽', 'SI=F':'⚪', 'HG=F':'🟠',
  }
};

function loadMarkets(force) {
  if (force) { delete CACHE['mkt_commodities']; delete CACHE['mkt_commentary']; marketsLoaded=false; }
  marketsLoaded = true;
  loadCommodities();
  loadMarketCommentary();
}

function makeSparkline(changePct, up) {
  const w=100, h=28, pts=20;
  const rng = Math.abs(changePct||1)*0.4+0.3;
  let prices=[50];
  for(let i=1;i<pts;i++) prices.push(prices[i-1]+(Math.random()-0.48)*rng*4);
  prices[pts-1]=prices[pts-2]+(up?Math.abs(changePct||1)*0.7:-Math.abs(changePct||1)*0.7);
  const mn=Math.min(...prices), mx=Math.max(...prices);
  const sy=v=>(h-((v-mn)/(mx-mn||1))*(h-4)-2);
  const sx=i=>(i/(pts-1))*w;
  const d=prices.map((p,i)=>(i===0?'M':'L')+sx(i).toFixed(1)+','+sy(p).toFixed(1)).join(' ');
  const color=up?'#4caf84':'#e05c5c';
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

async function loadCommodities() {
  const el = document.getElementById('ticker-commodities');
  if (!el) return;
  el.innerHTML = COMMODITIES.symbols.split(',').map(s => {
    const sym = s.replace(/[^a-zA-Z0-9]/g,'_');
    return `<div class="ticker-card loading-card" id="tc_${sym}">
      <div class="tc-sym">${s.replace('=F','').replace('^','')}</div>
      <div class="loading-spinner" style="width:12px;height:12px;margin:8px 0;"></div>
    </div>`;
  }).join('');

  try {
    const data = await apiFetch(
      '/api/markets/quote?symbols='+encodeURIComponent(COMMODITIES.symbols),
      { method:'GET' }, 'mkt_commodities', TTL.markets);
    const quotes = data.quotes || [];
    el.innerHTML = quotes.map(q => {
      const name  = COMMODITIES.names[q.symbol] || q.name || q.symbol;
      const icon  = COMMODITIES.icons[q.symbol] || '📊';
      const up    = (q.change||0) >= 0;
      const pr    = q.price != null ? (q.price>=1000
        ? q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
        : q.price.toFixed(q.price<10?4:2)) : '—';
      const pct   = q.changePercent != null ? (up?'+':'')+q.changePercent.toFixed(2)+'%' : '—';
      const chg   = q.change != null ? (up?'+':'')+q.change.toFixed(2) : '';
      const isAI  = data.source==='ai_estimate';
      return `<div class="ticker-card">
        <div class="tc-icon">${icon}</div>
        <div class="tc-sym">${esc(q.symbol.replace('=F','').replace('^',''))}</div>
        <div class="tc-name">${esc(name)}</div>
        ${makeSparkline(q.changePercent, up)}
        <div class="tc-price ${up?'up':'dn'}">${pr}</div>
        <div class="tc-chg ${up?'up':'dn'}">${pct}${chg?' ('+chg+')':''}</div>
        ${isAI ? '<span class="tc-badge ai-badge">AI Est.</span>' : '<span class="tc-badge live-badge">● Live</span>'}
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = `<div class="error-card">⚠ Failed to load prices. <button class="retry-btn" onclick="loadCommodities()">Retry</button></div>`;
  }
}

async function loadMarketCommentary() {
  const el = document.getElementById('marketCommentary');
  if (!el) return;
  try {
    const data = await apiFetch('/api/markets/commentary', {}, 'mkt_commentary', TTL.markets);
    let h = '';
    if (data.headline) h += `<div class="comm-headline">${esc(data.headline)}</div>`;
    const keys = [
      ['🛢️','Crude Oil','oil_commentary'],
      ['🥇','Gold','gold_commentary'],
      ['🔥','Natural Gas','gas_commentary'],
      ['🌾','Agriculture','agriculture_commentary'],
      ['🌍','Overview','summary'],
    ];
    keys.forEach(([icon, label, key]) => {
      if (!data[key]) return;
      h += `<div class="comm-item">
        <div class="comm-label">${icon} ${label}</div>
        <div class="comm-text">${esc(data[key])}</div>
      </div>`;
    });
    el.innerHTML = h || '<div class="muted">No commentary available</div>';
  } catch(e) {
    el.innerHTML = `<div class="error-card">⚠ Commentary unavailable</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  FLOATING CHAT
// ═══════════════════════════════════════════════════════════════════
let chatPanelHistory = [];

function toggleChatPanel() {
  const panel = document.getElementById('chatPanel');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) document.getElementById('chatPanelInput')?.focus();
}

async function sendChatPanel() {
  const inp = document.getElementById('chatPanelInput');
  const q = inp?.value?.trim();
  if (!q) return;
  inp.value = '';

  const msgs = document.getElementById('chatPanelMessages');
  chatPanelHistory.push({ role:'user', content: q });
  msgs.innerHTML += `<div class="chat-msg user">${esc(q)}</div>`;
  msgs.innerHTML += `<div class="chat-msg assistant loading-msg" id="chatLoading"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const data = await apiFetch('/api/ask',
      { body: JSON.stringify({ question: q, history: chatPanelHistory.slice(-10) }) }, null);
    const loading = document.getElementById('chatLoading');
    if (loading) loading.remove();
    const answer = data.answer || data.response || 'No response';
    chatPanelHistory.push({ role:'assistant', content: answer });
    msgs.innerHTML += `<div class="chat-msg assistant">${esc(answer)}</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  } catch(e) {
    const loading = document.getElementById('chatLoading');
    if (loading) loading.remove();
    msgs.innerHTML += `<div class="chat-msg assistant error">⚠ Error: ${esc(e.message)}</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  BREAKING TICKER
// ═══════════════════════════════════════════════════════════════════
async function loadBreakingTicker() {
  try {
    const data = await apiFetch('/api/news',
      { body: JSON.stringify({ topic: 'Middle East Ukraine breaking news' }) },
      'ticker_news', TTL.news);
    const items = (data.items||[]).slice(0,15).filter(i=>i.title);
    if (!items.length) return;
    const track = document.getElementById('tickerTrack');
    if (!track) return;
    const html = items.map(i => {
      const src = i.sources ? `[${i.sources}] ` : '';
      const lk = i.link ? ` href="${esc(i.link)}" target="_blank" rel="noopener"` : '';
      return `<span><a${lk}>${src}${esc(i.title)}</a></span>`;
    }).join('');
    track.innerHTML = html + html; // double for seamless loop
    // Adjust animation duration based on content
    const dur = Math.max(30, items.length * 6);
    track.style.animationDuration = dur + 's';
  } catch(e) { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════════
function initSettingsUI() {
  const dm = document.getElementById('darkModeToggle');
  if (dm) dm.checked = LS.get('darkMode', false);
  const ct = document.getElementById('citationsToggle');
  if (ct) ct.checked = showCitations;
}

function toggleDarkMode() {
  const on = document.getElementById('darkModeToggle').checked;
  document.documentElement.setAttribute('data-theme', on?'dark':'light');
  LS.set('darkMode', on);
}
function toggleCitations() {
  showCitations = document.getElementById('citationsToggle').checked;
  LS.set('citations', showCitations);
}
function clearCache() {
  Object.keys(CACHE).forEach(k => delete CACHE[k]);
  marketsLoaded = false;
  showToast('Cache cleared', 'success');
  if (currentTab==='news') loadNews(currentRegion);
}
function resetAll() {
  if (confirm('Reset all settings and clear cache?')) {
    localStorage.clear(); location.reload();
  }
}
function dismissDisclaimer() {
  const el = document.getElementById('disclaimerBanner');
  if (el) el.style.display='none';
  LS.set('discDismissed', true);
}

// ═══════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════
function showToast(msg, type='info') {
  document.getElementById('briefly-toast')?.remove();
  const colors = { info:'#2563eb', success:'#16a34a', error:'#dc2626', warning:'#d97706' };
  const t = document.createElement('div');
  t.id = 'briefly-toast';
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'90px', left:'50%', transform:'translateX(-50%)',
    background: colors[type]||colors.info, color:'#fff',
    padding:'10px 20px', borderRadius:'30px', fontSize:'13px', fontFamily:'var(--sans)',
    fontWeight:'600', zIndex:'9999', boxShadow:'0 4px 16px rgba(0,0,0,.3)',
    animation:'fadeInUp .25s ease', pointerEvents:'none', whiteSpace:'nowrap',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ═══════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// AIRSPACE — Country search
// ═══════════════════════════════════════════════════════════════════
let currentAirspaceCountry = null;

function selectAirspaceCountry(btn, country) {
  document.querySelectorAll('#airspaceChips .adv-chip').forEach(b => b.classList.remove('active'));
  if (currentAirspaceCountry === country) {
    currentAirspaceCountry = null;
    const lbl = document.getElementById('airspaceSectionLabel');
    if (lbl) lbl.textContent = 'Latest Aviation News';
    loadAirspaceNews();
    return;
  }
  btn.classList.add('active');
  currentAirspaceCountry = country;
  const lbl = document.getElementById('airspaceSectionLabel');
  if (lbl) lbl.textContent = 'Airspace — ' + country;
  loadAirspaceNewsForCountry(country);
}

function doAirspaceSearch() {
  const q = document.getElementById('airspaceSearchInput')?.value?.trim();
  if (!q) {
    document.querySelectorAll('#airspaceChips .adv-chip').forEach(b => b.classList.remove('active'));
    currentAirspaceCountry = null;
    const lbl = document.getElementById('airspaceSectionLabel');
    if (lbl) lbl.textContent = 'Latest Aviation News';
    loadAirspaceNews();
    return;
  }
  const lbl = document.getElementById('airspaceSectionLabel');
  if (lbl) lbl.textContent = 'Airspace: ' + q;
  loadAirspaceNewsForCountry(q);
}

async function loadAirspaceNewsForCountry(country) {
  const el = document.getElementById('airspaceContent');
  el.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>Loading airspace news for ' + esc(country) + '…</div>';
  const isAll = country === 'All MENA';
  const searchTerm = isAll
    ? 'MENA Middle East airspace flight ban restriction NOTAM aviation'
    : country + ' airspace flight ban restriction NOTAM aviation';
  try {
    const cKey = 'air_' + country.replace(/[^a-z0-9]/gi,'_');
    const data = await apiFetch('/api/news', {
      body: JSON.stringify({ topic: country + ' airspace aviation', search: searchTerm })
    }, cKey, TTL.air);
    renderAirspaceNews(data, country);
  } catch(e) {
    el.innerHTML = '<div class="error-card">&#x26a0; Failed to load. <button class="retry-btn" onclick="loadAirspaceNews()">Retry</button></div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
// ADVISORIES — Free-text search
// ═══════════════════════════════════════════════════════════════════
function doAdvisorySearch() {
  const q = document.getElementById('advisorySearchInput')?.value?.trim();
  if (!q) return;
  let found = false;
  document.querySelectorAll('#advisoryChips .adv-chip').forEach(btn => {
    const c = btn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (c && c.toLowerCase() === q.toLowerCase()) {
      if (!advisoryActive.has(c)) toggleAdvisory(btn, c);
      found = true;
    }
  });
  if (!found) {
    const el = document.getElementById('advisoryContent');
    if (el.querySelector('.empty-state')) el.innerHTML = '';
    advisoryActive.add(q);
    loadAdvisoryCountry(q);
  }
  if (document.getElementById('advisorySearchInput'))
    document.getElementById('advisorySearchInput').value = '';
}

(function init() {
  // Theme
  const useDark = LS.get('darkMode', false);
  document.documentElement.setAttribute('data-theme', useDark ? 'dark' : 'light');

  // Restore preferences
  showCitations = LS.get('citations', true);
  showAiBadge   = LS.get('aiBadge', true);
  currentBriefTopic = LS.get('lastBrief', '');

  // Dismiss banner if already dismissed
  if (LS.get('discDismissed', false)) {
    const d = document.getElementById('disclaimerBanner');
    if (d) d.style.display='none';
  }

  // Restore last region — default to Middle East
  currentRegion = LS.get('lastRegion', 'Middle East & Africa');
  document.querySelectorAll('#regionPills .pill').forEach(b => {
    const r = b.getAttribute('onclick')?.match(/'([^']+)'\)/)?.[1];
    if (r) b.classList.toggle('active', r===currentRegion);
  });

  // Brief input
  if (currentBriefTopic) {
    const inp = document.getElementById('briefSearchInput');
    if (inp) inp.value = currentBriefTopic;
  }

  // Load initial tab
  const lastTab = LS.get('lastTab', 'news');
  switchTab(lastTab);

  // Breaking ticker
  loadBreakingTicker();

  // Auto-refresh every 15 minutes
  setInterval(() => {
    if (currentTab==='news') loadNews(currentRegion);
    else if (currentTab==='markets') { marketsLoaded=false; loadMarkets(); }
  }, 15*60000);
})();
