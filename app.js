
const API = 'https://claudebriefly.onrender.com';
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 8000;

let currentTab = 'news';
let currentRegion = 'Global/World';
let currentAirspace = '';
let currentBriefTopic = '';
let currentPressRegion = 'Global/World';
let autoRefreshEnabled = true;
let refreshIntervalMins = 15;
let showCitations = true;
let showAiBadge = true;
let refreshTimer = null;
let archiveItems = [];

function archiveSave(topic, analysis) {
  try {
    const item = {
      id: Date.now(),
      topic,
      ts: new Date().toISOString(),
      threat_level: analysis.threat_level || 'UNKNOWN',
      confidence: analysis.confidence || 0,
      executive: (analysis.executive || '').slice(0, 200),
    };
    archiveItems = LS.get('archive', []);
    // Avoid duplicates — remove any existing entry for same topic
    archiveItems = archiveItems.filter(i => i.topic?.toLowerCase() !== topic.toLowerCase());
    archiveItems.unshift(item);
    if (archiveItems.length > 50) archiveItems = archiveItems.slice(0, 50);
    LS.set('archive', archiveItems);
  } catch(e) { console.warn('archiveSave error:', e.message); }
}
let marketsLoaded = false;
let leafletMap = null;

function initMap() {
  const container = document.getElementById('airspaceMap');
  if (!container || leafletMap) return;
  container.style.height = '280px';
  container.style.borderRadius = 'var(--radius)';
  container.style.overflow = 'hidden';
  container.style.marginBottom = '20px';
  container.style.border = '1px solid var(--border)';
  try {
    leafletMap = L.map('airspaceMap', { zoomControl: true, scrollWheelZoom: false })
      .setView([20, 10], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd', maxZoom: 18
    }).addTo(leafletMap);
    // Fix map tiles not rendering on tab switch
    setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 300);
  } catch(e) { console.warn('Map init error:', e); }
}
let chatHistory = [];

const CACHE = {};
const CACHE_TTL = { news: 5*60000, brief: 30*60000, markets: 10*60000, default: 15*60000 };

function cacheGet(key, ttl) {
  const e = CACHE[key];
  if (!e) return null;
  if (Date.now() - e.ts > ttl) { delete CACHE[key]; return null; }
  return e.data;
}
function cacheSet(key, data) { CACHE[key] = { data, ts: Date.now() }; }

const LS = {
  get(k, def) { try { const v = localStorage.getItem('briefly_' + k); return v != null ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('briefly_' + k, JSON.stringify(v)); } catch {} },
};

async function apiFetch(path, opts, cKey, ttl) {
  if (cKey) { const c = cacheGet(cKey, ttl || CACHE_TTL.default); if (c) return c; }
  const merged = { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...opts };
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    try {
      const r = await fetch(API + path, merged);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (cKey) cacheSet(cKey, data);
      return data;
    } catch (e) {
      if (i < RETRY_ATTEMPTS - 1) await new Promise(res => setTimeout(res, RETRY_DELAY));
      else throw e;
    }
  }
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function cleanBody(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g,' ').replace(/https?:\/\/\S+/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#\d+;/g,'')
    .replace(/\s+/g,' ').trim().slice(0,220);
}
function formatDate(str) {
  try { const d = new Date(str); if (isNaN(d)) return str; return d.toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return str; }
}
function showLoading(el, msg) { el.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div>' + (msg||'Loading…') + '</div>'; }
function showError(el, msg, retryFn) {
  el.innerHTML = '<div class="error-state">⚠ ' + esc(msg) + (retryFn ? '<button class="error-retry" onclick="'+retryFn.toString().replace(/"/g,"'")+'()">Retry</button>' : '') + '</div>';
}

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('tab-'+tab); if (el) el.classList.add('active');
  const nb = document.getElementById('nav-'+tab); if (nb) nb.classList.add('active');
  currentTab = tab; LS.set('lastTab', tab);
  if (tab === 'news') loadNews(currentRegion);
  else if (tab === 'markets' && !marketsLoaded) loadMarkets();
  // Archive removed - use Dashboard tab
  else if (tab === 'airspace') {
    if (!leafletMap) initMap();
    else setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 100);
  }
  else if (tab === 'settings') initSettingsUI();
  else if (tab === 'dashboard') renderDashboardTab();
  else if (tab === 'press' && !document.getElementById('pressContent').innerHTML.trim()) loadPress(currentPressRegion);
}

function selectRegion(btn, region) {
  document.querySelectorAll('#regionPills .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentRegion = region; LS.set('lastRegion', region);
  loadNews(region);
}

async function loadNews(region, search) {
  currentRegion = region || currentRegion;
  const el = document.getElementById('newsContent');
  showLoading(el, 'Loading ' + (search ? 'search results' : currentRegion + ' headlines') + '…');
  const cKey = search ? 'search_'+search : 'news_'+currentRegion;
  try {
    const data = await apiFetch('/api/news', { body: JSON.stringify({ topic: currentRegion, search: search||undefined }) }, cKey, CACHE_TTL.news);
    el._lastData = data; el._lastQuery = search||null; renderNews(data, el, search||null);
  } catch (e) {
    el.innerHTML = '<div class="card"><div class="error-state">⚠ Failed to load news. Backend may be warming up (30s). <button class="error-retry" onclick="loadNews(currentRegion)">Retry</button></div></div>';
  }
}

function renderNews(data, el, searchQuery) {
  const allItems = data.items || [];
  // Apply date filter
  const now = Date.now();
  const dateMs = { all: 0, day: 86400000, week: 604800000, month: 2592000000 };
  const cutoff = dateMs[newsDateFilter] || 0;
  let items = cutoff
    ? allItems.filter(i => i.pubDate && (now - new Date(i.pubDate).getTime()) < cutoff)
    : allItems;
  // Apply sort
  if (newsSort === 'oldest') items = [...items].sort((a,b) => new Date(a.pubDate||0) - new Date(b.pubDate||0));
  else items = [...items].sort((a,b) => new Date(b.pubDate||0) - new Date(a.pubDate||0));

  let h = '<div class="card">';
  h += '<div class="news-label">' + esc(data.isLive ? '🔴 Live Feed' : '📋 AI Summary') + '</div>';
  h += '<div class="news-header-row"><div class="news-headline">' + esc(data.headline||'Headlines') + '</div>';
  h += '<button class="news-refresh" onclick="delete CACHE[\'news_\'+currentRegion];loadNews(currentRegion)" title="Refresh">↺</button></div>';
  h += '<div class="news-summary">' + esc(data.summary||'') + (data.fetchedAt ? ' <span style="opacity:.5">· '+formatDate(data.fetchedAt)+'</span>' : '') + '</div>';
  h += '<div class="news-count">' + items.length + ' of ' + allItems.length + ' headlines';
  if (cutoff) h += ' (filtered to ' + ({day:'24h',week:'7 days',month:'30 days'}[newsDateFilter]) + ')';
  h += '</div>';

  items.forEach((item, i) => {
    const body = cleanBody(item.body);
    const lk = item.link ? ' href="'+esc(item.link)+'" target="_blank" rel="noopener"' : '';
    const imgId = 'nimg_' + i;
    // Highlight search terms in title
    const titleHtml = searchQuery ? highlightTerms(esc(item.title), searchQuery) : esc(item.title);
    const bodyHtml  = searchQuery && body ? highlightTerms(esc(body), searchQuery) : (body ? esc(body) : '');

    h += '<div class="brief-item">';
    // Image slot — will be lazy-loaded after render
    if (item.link && item.isLive) {
      h += '<div class="news-item-img-placeholder" id="'+imgId+'" data-url="'+esc(item.link)+'">📰</div>';
    }
    h += '<div class="brief-item-body">';
    h += '<div class="brief-content"><strong><a'+lk+'>'+titleHtml+'</a></strong>';
    if (bodyHtml) h += '<br/><span style="opacity:.8">'+bodyHtml+'</span>';
    h += '</div><div class="brief-source">';
    if (item.sourceUrl) h += '<a href="'+esc(item.sourceUrl)+'" target="_blank" rel="noopener">'+esc(item.sources)+'</a>';
    else h += esc(item.sources||'');
    if (item.pubDate) h += '<span class="news-date-badge">'+formatDate(item.pubDate)+'</span>';
    if (item.isLive) h += ' <span class="live-badge">● Live</span>';
    else if (showAiBadge) h += ' <span class="ai-badge">AI</span>';
    h += '</div></div></div>';
  });
  h += '</div>';
  el.innerHTML = h;

  // Lazy-load OG images after render
  if (data.isLive) lazyLoadNewsImages(items);
}

function highlightTerms(text, query) {
  if (!query) return text;
  const terms = query.trim().split(/\s+/).filter(t => t.length > 2);
  let result = text;
  terms.forEach(term => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp('(' + escaped + ')', 'gi'), '<span class="highlight">$1</span>');
  });
  return result;
}

async function lazyLoadNewsImages(items) {
  const BE = 'https://claudebriefly.onrender.com';
  for (let i = 0; i < Math.min(items.length, 8); i++) {
    const item = items[i];
    if (!item.link) continue;
    const el = document.getElementById('nimg_' + i);
    if (!el) continue;
    try {
      const r = await fetch(BE + '/api/og-image?url=' + encodeURIComponent(item.link));
      const d = await r.json();
      if (d.image) {
        const img = document.createElement('img');
        img.className = 'news-item-img';
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => { img.style.display='none'; el.style.display='flex'; };
        img.src = d.image;
        el.parentNode.replaceChild(img, el);
      }
    } catch(e) { /* keep placeholder */ }
  }
}

function searchHeadlines() { const q = document.getElementById('headerSearchInput').value.trim(); if (q) { switchTab('news'); loadNews(currentRegion, q); } }
function searchHeadlinesMobile() { const q = document.getElementById('mobileSearchInput').value.trim(); if (q) { switchTab('news'); loadNews(currentRegion, q); } }
document.getElementById('headerSearchInput').addEventListener('keydown', e => { if (e.key==='Enter') searchHeadlines(); });
document.getElementById('mobileSearchInput').addEventListener('keydown', e => { if (e.key==='Enter') searchHeadlinesMobile(); });

// ── NEWS SEARCH + FILTER STATE ────────────────────────────────────────────────
let newsDateFilter = 'all';
let newsSort = 'newest';
const NEWS_SEARCH_HISTORY_KEY = 'briefly_search_history';

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem(NEWS_SEARCH_HISTORY_KEY) || '[]'); } catch(e) { return []; }
}
function addSearchHistory(q) {
  if (!q || q.length < 2) return;
  let hist = getSearchHistory().filter(h => h.toLowerCase() !== q.toLowerCase());
  hist.unshift(q);
  hist = hist.slice(0, 12);
  try { localStorage.setItem(NEWS_SEARCH_HISTORY_KEY, JSON.stringify(hist)); } catch(e) {}
}

function setNewsDateFilter(btn, filter) {
  newsDateFilter = filter;
  document.querySelectorAll('.news-filters .news-filter-btn').forEach(b => {
    if (['all','day','week','month'].some(f => b.getAttribute('onclick')?.includes("'"+f+"'"))) b.classList.remove('active');
  });
  btn.classList.add('active');
  // Re-render with current data if available
  const el = document.getElementById('newsContent');
  if (el && el._lastData) renderNews(el._lastData, el, el._lastQuery);
}

function setNewsSort(sort) {
  newsSort = sort;
  document.getElementById('sortNewestBtn')?.classList.toggle('active', sort === 'newest');
  document.getElementById('sortOldestBtn')?.classList.toggle('active', sort === 'oldest');
  const el = document.getElementById('newsContent');
  if (el && el._lastData) renderNews(el._lastData, el, el._lastQuery);
}

function doNewsSearch() {
  const q = document.getElementById('newsSearchInput')?.value?.trim();
  hideNewsAutocomplete();
  if (!q) {
    clearNewsSearch();
    return;
  }
  addSearchHistory(q);
  // Show meta
  const meta = document.getElementById('newsSearchMeta');
  if (meta) {
    meta.style.display = 'block';
    meta.innerHTML = 'Searching for <strong style="color:var(--gold)">"'+esc(q)+'"</strong>' +
      '<button class="news-clear-search" onclick="clearNewsSearch()">✕ Clear</button>';
  }
  loadNews(null, q);
}

function askSuggestion(el) {
  const q = el.textContent;
  const input = document.getElementById('askInput');
  if (input) { input.value = q; input.focus(); }
  document.getElementById('askSuggestions')?.remove();
  askQuestion();
}

function clearNewsSearch() {
  const input = document.getElementById('newsSearchInput');
  if (input) input.value = '';
  const meta = document.getElementById('newsSearchMeta');
  if (meta) meta.style.display = 'none';
  loadNews(currentRegion);
}

function newsSearchAutocomplete(val) {
  const box = document.getElementById('newsAutocomplete');
  if (!box) return;
  if (!val || val.length < 2) {
    showRecentSearches();
    return;
  }
  const hist = getSearchHistory().filter(h => h.toLowerCase().includes(val.toLowerCase())).slice(0, 6);
  const suggestions = [
    ...hist,
    ...['Gaza ceasefire','Russia Ukraine war','US China trade','Iran nuclear','Oil prices','Taiwan strait',
        'North Korea','Sudan conflict','NATO summit','Federal Reserve','Middle East','Climate summit']
      .filter(s => s.toLowerCase().includes(val.toLowerCase()) && !hist.includes(s))
      .slice(0, 4 - hist.length)
  ];
  if (!suggestions.length) { hideNewsAutocomplete(); return; }
  box.innerHTML = suggestions.map(s =>
    '<div class="search-autocomplete-item" onmousedown="selectAutocomplete(\''+esc(s)+'\')">' +
    '<span class="search-hist-icon">' + (hist.includes(s) ? '🕐' : '🔍') + '</span>' +
    highlightTerms(esc(s), val) + '</div>'
  ).join('');
  box.style.display = 'block';
}

function showRecentSearches() {
  const box = document.getElementById('newsAutocomplete');
  if (!box) return;
  const hist = getSearchHistory().slice(0, 6);
  if (!hist.length) { hideNewsAutocomplete(); return; }
  box.innerHTML = '<div style="padding:6px 14px;font-family:var(--cond);font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:rgba(232,213,163,0.3);">Recent searches</div>' +
    hist.map(s =>
      '<div class="search-autocomplete-item" onmousedown="selectAutocomplete(\''+esc(s)+'\')">' +
      '<span class="search-hist-icon">🕐</span>' + esc(s) + '</div>'
    ).join('');
  box.style.display = 'block';
}

function showNewsAutocomplete() {
  const val = document.getElementById('newsSearchInput')?.value || '';
  if (val.length >= 2) newsSearchAutocomplete(val);
  else showRecentSearches();
}

function hideNewsAutocomplete() {
  const box = document.getElementById('newsAutocomplete');
  if (box) box.style.display = 'none';
}

function selectAutocomplete(val) {
  const input = document.getElementById('newsSearchInput');
  if (input) { input.value = val; }
  hideNewsAutocomplete();
  addSearchHistory(val);
  const meta = document.getElementById('newsSearchMeta');
  if (meta) {
    meta.style.display = 'block';
    meta.innerHTML = 'Searching for <strong style="color:var(--gold)">"'+esc(val)+'"</strong>' +
      '<button class="news-clear-search" onclick="clearNewsSearch()">✕ Clear</button>';
  }
  loadNews(null, val);
}

// ── PATCH: also wire up the header search to switch to news tab ───────────────
function searchHeadlines() {
  const q = document.getElementById('headerSearchInput')?.value?.trim();
  if (!q) return;
  // Switch to news tab
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const newsTab = document.getElementById('tab-news');
  if (newsTab) newsTab.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => { if(b.getAttribute('onclick')?.includes('news')) b.classList.add('active'); });
  // Fill and fire news search
  const newsInput = document.getElementById('newsSearchInput');
  if (newsInput) { newsInput.value = q; }
  addSearchHistory(q);
  const meta = document.getElementById('newsSearchMeta');
  if (meta) {
    meta.style.display = 'block';
    meta.innerHTML = 'Searching for <strong style="color:var(--gold)">"'+esc(q)+'"</strong>' +
      '<button class="news-clear-search" onclick="clearNewsSearch()">✕ Clear</button>';
  }
  loadNews(null, q);
}

function quickBrief(topic) {
  document.getElementById('briefSearchInput').value = topic;
  generateBrief();
}

// Scroll to top button
window.addEventListener('scroll', () => {
  const btn = document.getElementById('scrollTopBtn');
  if (btn) btn.classList.toggle('visible', window.scrollY > 400);
}, { passive: true });

// Dual-engine mode: Gemini searches live, Claude synthesises — no toggle needed

const THREAT_ICONS = { CRITICAL:'🔴', HIGH:'🟠', ELEVATED:'🟡', MODERATE:'🔵', LOW:'🟢' };

async function generateBrief() {
  const q = document.getElementById('briefSearchInput').value.trim() || currentBriefTopic;
  if (!q) { alert('Please enter a topic first.'); return; }
  currentBriefTopic = q; LS.set('lastBrief', q);
  document.getElementById('briefTitleText').textContent = q;
  const el = document.getElementById('briefContent');
  // Animated progress stages
  const stages = [
    { icon: '🔍', text: 'Searching live sources…', sub: 'Claude web search + Google News RSS' },
    { icon: '📡', text: 'Gathering intelligence…', sub: 'Gemini grounding + Groq context analysis' },
    { icon: '🧠', text: 'Synthesizing assessment…', sub: 'Cross-referencing sources and building brief' },
    { icon: '📋', text: 'Finalizing brief…', sub: 'Structuring threat levels and key actors' },
  ];
  let stageIdx = 0;
  function renderStage(s) {
    el.innerHTML = `<div style="padding:40px 0;text-align:center;">
      <div style="font-size:36px;margin-bottom:16px;animation:pulse 1.5s infinite">${s.icon}</div>
      <div style="font-family:var(--serif);font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;">${s.text}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:24px;">${s.sub}</div>
      <div style="display:flex;justify-content:center;gap:6px;">
        ${stages.map((_,i) => `<div style="width:8px;height:8px;border-radius:50%;background:${i===stageIdx?'var(--accent)':'var(--border)'};transition:background 0.3s;"></div>`).join('')}
      </div>
    </div>`;
  }
  renderStage(stages[0]);
  const stageTimer = setInterval(() => {
    stageIdx = Math.min(stageIdx + 1, stages.length - 1);
    renderStage(stages[stageIdx]);
  }, 7000);

  const btn = document.getElementById('briefGenerateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing…'; }
  try {
    const data = await apiFetch('/api/briefing', { body: JSON.stringify({ topic: q, force: !!window._briefForce }) }, null);
    clearInterval(stageTimer);
    if (data.cached) {
      el.innerHTML = '<div style="padding:10px 0 4px;text-align:center;font-size:12px;color:var(--muted);">⚡ Served from cache · <a href="#" onclick="generateBriefForce()" style="color:var(--accent)">Refresh</a></div>';
      setTimeout(() => { const cacheNote = el.querySelector('div'); if(cacheNote) cacheNote.remove(); }, 3000);
    }
    const a = data.analysis || {};
    window._lastBriefData = { analysis: a, topic: q, liveHeadlines: data.liveHeadlines || [] };
    const liveHeadlines = data.liveHeadlines || [];
    const ts = new Date().toLocaleString('en-US',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'}) + ' UTC';
    const threat = (a.threat_level || 'MODERATE').toUpperCase();
    const conf = a.confidence || 75;
    const threatIcon = THREAT_ICONS[threat] || '🔵';

    let h = '';

    // Actions bar
    h += '<div class="brief-actions-row">';
    h += '<button class="copy-btn" id="copyBriefBtn" onclick="copyBrief()">📋 Copy Brief</button>';
    h += '<button class="btn-outline" id="exportPDFBtn" onclick="exportBriefPDF()">📥 Export PDF</button>';
    h += '<button class="dash-save-btn" id="saveToDashBtn" onclick="saveBriefToCloud()">☁ Save to Dashboard</button>';
    if (showAiBadge) h += '<span class="ai-badge" style="padding:7px 14px;">🤖 AI Analysis</span>';
    h += '</div>';

    // Meta bar
    h += '<div class="brief-meta-bar">';
    h += '<span>📅 '+ts+'</span>';
    h += '<span>🔐 INTELLIGENCE BRIEF</span>';
    if (liveHeadlines.length) h += '<span class="live-badge">● Live Context</span>';
    h += '</div>';

    // Threat level banner
    h += '<div class="threat-banner threat-'+threat+'">';
    h += '<div class="threat-icon">'+threatIcon+'</div>';
    h += '<div><div class="threat-label">Threat Assessment</div><div class="threat-value">'+threat+'</div></div>';
    if (a.threat_level_reason) h += '<div class="threat-reason">'+esc(a.threat_level_reason)+'</div>';
    h += '<div class="confidence-bar-wrap"><span class="confidence-label">Confidence</span><div class="confidence-bar"><div class="confidence-fill" style="width:'+conf+'%"></div></div><span class="confidence-pct">'+conf+'%</span></div>';
    h += '</div>';

    // Two-column grid
    h += '<div class="brief-grid">';

    // ── MAIN COLUMN ──
    h += '<div class="brief-main-col">';

    // Executive Summary
    if (a.executive) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">📌</span><span class="brief-section-title">Executive Summary</span></div>';
      h += '<div class="brief-section-body">'+esc(a.executive)+'</div>';
      h += '</div>';
    }

    // Situation
    if (a.situation) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">📡</span><span class="brief-section-title">Current Situation</span></div>';
      h += '<div class="brief-section-body">'+esc(a.situation)+'</div>';
      h += '</div>';
    }

    // Geopolitical
    if (a.geopolitical) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">🌐</span><span class="brief-section-title">Geopolitical Analysis</span></div>';
      h += '<div class="brief-section-body">'+esc(a.geopolitical)+'</div>';
      h += '</div>';
    }

    // Humanitarian + Economic side by side
    if (a.humanitarian || a.economic) {
      h += '<div style="display:grid;grid-template-columns:1fr;gap:14px;">';
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">';
      if (a.humanitarian) {
        h += '<div class="brief-section"><div class="brief-section-header"><span class="brief-section-icon">🏥</span><span class="brief-section-title">Humanitarian</span></div><div class="brief-section-body" style="font-size:13px;">'+esc(a.humanitarian)+'</div></div>';
      }
      if (a.economic) {
        h += '<div class="brief-section"><div class="brief-section-header"><span class="brief-section-icon">📊</span><span class="brief-section-title">Economic Impact</span></div><div class="brief-section-body" style="font-size:13px;">'+esc(a.economic)+'</div></div>';
      }
      h += '</div></div>';
    }

    // Strategic Outlook
    if (a.strategic) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">🎯</span><span class="brief-section-title">Strategic Outlook</span></div>';
      h += '<div class="brief-section-body">'+esc(a.strategic)+'</div>';
      h += '</div>';
    }

    h += '</div>'; // end main col

    // ── SIDE COLUMN ──
    h += '<div class="brief-side-col">';

    // Key Actors
    if (a.key_actors?.length) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">👤</span><span class="brief-section-title">Key Actors</span></div>';
      h += '<div class="actor-list">';
      a.key_actors.slice(0,5).forEach(actor => {
        h += '<div class="actor-card">';
        h += '<div class="actor-name">'+esc(actor.name||'')+'</div>';
        h += '<div class="actor-role">'+esc(actor.role||'')+'</div>';
        h += '<div class="actor-stance">'+esc(actor.stance||'')+'</div>';
        h += '</div>';
      });
      h += '</div></div>';
    }

    // Timeline
    if (a.timeline?.length) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">🕐</span><span class="brief-section-title">Timeline</span></div>';
      h += '<div class="timeline-list">';
      a.timeline.slice(0,6).forEach(ev => {
        h += '<div class="tl-item"><div class="tl-date">'+esc(ev.date||'')+'</div><div class="tl-event">'+esc(ev.event||'')+'</div></div>';
      });
      h += '</div></div>';
    }

    // Key Risks
    if (a.key_risks?.length) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">⚠️</span><span class="brief-section-title">Key Risks</span></div>';
      h += '<div class="risk-list">';
      a.key_risks.forEach(r => { h += '<div class="risk-item">'+esc(r)+'</div>'; });
      h += '</div></div>';
    }

    // Watch Points
    if (a.watch_points?.length) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">👁</span><span class="brief-section-title">Watch Points</span></div>';
      h += '<div class="watch-list">';
      a.watch_points.forEach(w => { h += '<div class="watch-item">'+esc(w)+'</div>'; });
      h += '</div></div>';
    }

    // Related Topics
    if (a.related_topics?.length) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">🔗</span><span class="brief-section-title">Related Topics</span></div>';
      h += '<div class="related-chips">';
      a.related_topics.forEach(t => { h += '<span class="related-chip" onclick="quickBrief(\''+t.replace(/'/g,"\\'")+'\');">'+esc(t)+'</span>'; });
      h += '</div></div>';
    }

    // Live Headlines
    if (liveHeadlines.length) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">📰</span><span class="brief-section-title">Live Headlines <span class="live-badge">● Live</span></span></div>';
      h += '<div class="live-headlines-list">';
      liveHeadlines.slice(0,6).forEach(hl => {
        const lk = hl.link ? 'href="'+esc(hl.link)+'" target="_blank" rel="noopener"' : '';
        h += '<div class="live-hl"><a '+lk+'>'+esc(hl.title)+'</a></div>';
      });
      h += '</div></div>';
    }

    // Sources
    if (showCitations && a.sources?.length) {
      h += '<div class="brief-section">';
      h += '<div class="brief-section-header"><span class="brief-section-icon">📎</span><span class="brief-section-title">Verify Sources</span></div>';
      h += '<div style="display:flex;flex-direction:column;gap:6px;">';
      a.sources.forEach(src => {
        h += '<a href="'+esc(src.url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--bg2);border-radius:8px;text-decoration:none;color:var(--text);font-size:13px;transition:background .15s;">';
        h += '<span style="color:var(--gold);">→</span>'+esc(src.name)+'</a>';
      });
      h += '</div></div>';
    }

    h += '</div>'; // end side col
    h += '</div>'; // end grid

    el.innerHTML = h;
    archiveSave(q, a);
  } catch (e) {
    clearInterval(stageTimer);
    el.innerHTML = '<div class="error-state">⚠ Failed to generate brief: '+esc(e.message)+' <button class="error-retry" onclick="generateBrief()">Retry</button></div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate Brief'; }
  }
}

function copyBrief() {
  const sections = document.querySelectorAll('#briefContent .brief-section');
  let text = currentBriefTopic.toUpperCase() + ' — INTELLIGENCE BRIEF\n' + '═'.repeat(60) + '\n';
  text += 'Generated: ' + new Date().toUTCString() + '\nSource: Briefly Intelligence v4.5\n\n';
  sections.forEach(s => {
    const title = s.querySelector('.brief-section-title');
    const body = s.querySelector('.brief-section-body');
    if (title && body) text += title.textContent.trim() + '\n' + '─'.repeat(40) + '\n' + body.textContent.trim() + '\n\n';
  });
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBriefBtn');
    if (btn) { btn.textContent = '✓ Copied!'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = '📋 Copy Brief'; btn.classList.remove('copied'); }, 2500); }
  });
}
async function exportBriefPDF() {
  const btn = document.getElementById('exportPDFBtn');
  const copyBtn = document.getElementById('copyBriefBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

  try {
    // Load jsPDF dynamically
    if (!window.jspdf) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const { jsPDF } = window.jspdf;

    // Get data directly from stored analysis object — never from DOM
    const stored = window._lastBriefData;
    if (!stored) throw new Error('No brief loaded yet');
    const a = stored.analysis;
    const topic = stored.topic || currentBriefTopic || 'Intelligence Brief';
    const headlines = stored.liveHeadlines || [];

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, margin = 16, contentW = W - margin * 2;
    let y = 0;

    // ── HELPERS ───────────────────────────────────────────────────────────────
    function newPage() { doc.addPage(); y = 20; }
    function checkPage(needed) { if (y + needed > 278) newPage(); }

    function addWrappedText(text, x, maxW, fontSize, style, rgb) {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', style || 'normal');
      doc.setTextColor(...(rgb || [20, 20, 40]));
      const lines = doc.splitTextToSize(String(text || '').replace(/\s+/g,' ').trim(), maxW);
      checkPage(lines.length * fontSize * 0.38 + 2);
      doc.text(lines, x, y);
      y += lines.length * fontSize * 0.38 + 2;
    }

    function addSectionHeader(tag, title) {
      checkPage(14);
      // Full-width gold box with title inside
      doc.setFillColor(200, 168, 75);
      doc.roundedRect(margin, y, contentW, 8, 1.5, 1.5, 'F');
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 22, 35);
      doc.text(title.toUpperCase(), margin + 5, y + 5.8);
      y += 13;
    }

    function addBullet(text, indent) {
      const ix = margin + (indent || 0);
      const bw = contentW - (indent || 0);
      doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 55);
      const lines = doc.splitTextToSize(String(text || '').trim(), bw - 5);
      checkPage(lines.length * 4 + 2);
      doc.setFillColor(200, 168, 75);
      doc.circle(ix + 1.5, y - 0.5, 0.8, 'F');
      doc.text(lines, ix + 5, y);
      y += lines.length * 4 + 2;
    }

    // ── HEADER ────────────────────────────────────────────────────────────────
    doc.setFillColor(12, 18, 30);
    doc.rect(0, 0, W, 38, 'F');

    doc.setFillColor(200, 168, 75);
    doc.rect(margin, 10, 1.5, 20, 'F');

    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(200, 168, 75);
    doc.text('BRIEFLY INTELLIGENCE  ·  INTELLIGENCE BRIEF', margin + 5, 14);

    doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.setTextColor(235, 228, 210);
    doc.text(topic.toUpperCase().slice(0, 40), margin + 5, 26);

    const ts = new Date().toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }) + ' UTC';
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 120, 140);
    doc.text(ts + '  ·  AI-GENERATED — VERIFY WITH OFFICIAL SOURCES', margin + 5, 34);
    y = 46;

    // ── THREAT LEVEL ──────────────────────────────────────────────────────────
    const threat = (a.threat_level || 'MODERATE').toUpperCase();
    const tColors = {
      CRITICAL:[180,30,30], HIGH:[210,60,40], ELEVATED:[200,110,20],
      MODERATE:[30,100,170], LOW:[30,140,80]
    };
    const tc = tColors[threat] || [80,80,80];
    checkPage(16);
    doc.setFillColor(...tc);
    doc.roundedRect(margin, y, contentW, 11, 2, 2, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
    doc.text('THREAT LEVEL: ' + threat + '   |   CONFIDENCE: ' + (a.confidence||'—') + '%   |   SOURCES: ' + (a.data_sources||'—'), margin + 4, y + 7.5);
    y += 16;

    if (a.threat_level_reason) {
      doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor(100,80,40);
      const reasonLines = doc.splitTextToSize(a.threat_level_reason, contentW);
      doc.text(reasonLines, margin, y);
      y += reasonLines.length * 4 + 6;
    }

    // ── CONFIDENCE BAR ────────────────────────────────────────────────────────
    const conf = Math.min(100, Math.max(0, a.confidence || 50));
    checkPage(10);
    doc.setFillColor(225, 220, 210);
    doc.roundedRect(margin, y, contentW, 4, 1, 1, 'F');
    const confColor = conf >= 70 ? [45,130,80] : conf >= 40 ? [200,110,20] : [180,40,40];
    doc.setFillColor(...confColor);
    doc.roundedRect(margin, y, contentW * conf / 100, 4, 1, 1, 'F');
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
    doc.text('Intelligence Confidence', margin, y + 8);
    doc.text(conf + '%', margin + contentW, y + 8, { align: 'right' });
    y += 14;

    // ── EXECUTIVE SUMMARY ─────────────────────────────────────────────────────
    if (a.executive) {
      addSectionHeader('[EXEC]', 'Executive Summary');
      addWrappedText(a.executive, margin, contentW, 9.5, 'normal', [20, 20, 40]);
      y += 5;
    }

    // ── CURRENT SITUATION ─────────────────────────────────────────────────────
    if (a.situation) {
      addSectionHeader('[SITREP]', 'Current Situation');
      addWrappedText(a.situation, margin, contentW, 9.5, 'normal', [20, 20, 40]);
      y += 5;
    }

    // ── GEOPOLITICAL ANALYSIS ─────────────────────────────────────────────────
    if (a.geopolitical) {
      addSectionHeader('[GEO]', 'Geopolitical Analysis');
      addWrappedText(a.geopolitical, margin, contentW, 9.5, 'normal', [20, 20, 40]);
      y += 5;
    }

    // ── HUMANITARIAN ──────────────────────────────────────────────────────────
    if (a.humanitarian) {
      addSectionHeader('[HUM]', 'Humanitarian');
      addWrappedText(a.humanitarian, margin, contentW, 9.5, 'normal', [20, 20, 40]);
      y += 5;
    }

    // ── ECONOMIC IMPACT ───────────────────────────────────────────────────────
    if (a.economic) {
      addSectionHeader('[ECON]', 'Economic Impact');
      addWrappedText(a.economic, margin, contentW, 9.5, 'normal', [20, 20, 40]);
      y += 5;
    }

    // ── STRATEGIC OUTLOOK ─────────────────────────────────────────────────────
    if (a.strategic) {
      addSectionHeader('[STRAT]', 'Strategic Outlook');
      addWrappedText(a.strategic, margin, contentW, 9.5, 'normal', [20, 20, 40]);
      y += 5;
    }

    // ── KEY ACTORS ────────────────────────────────────────────────────────────
    if (a.key_actors?.length) {
      addSectionHeader('[ACTORS]', 'Key Actors');
      a.key_actors.slice(0, 8).forEach(actor => {
        checkPage(14);
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 40);
        doc.text(String(actor.name || ''), margin + 2, y);
        doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor(100, 80, 40);
        doc.text(String(actor.role || ''), margin + 2, y + 4.5);
        if (actor.stance) {
          doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 80);
          const sl = doc.splitTextToSize(String(actor.stance), contentW - 4);
          doc.text(sl, margin + 2, y + 9);
          y += sl.length * 3.5 + 10;
        } else {
          y += 9;
        }
        doc.setDrawColor(220, 215, 205);
        doc.line(margin, y, margin + contentW, y);
        y += 3;
      });
      y += 3;
    }

    // ── TIMELINE ──────────────────────────────────────────────────────────────
    if (a.timeline?.length) {
      addSectionHeader('[TL]', 'Timeline');
      a.timeline.slice(0, 10).forEach(ev => {
        checkPage(10);
        doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(160, 120, 40);
        doc.text(String(ev.date || ''), margin + 2, y);
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 40);
        const el = doc.splitTextToSize(String(ev.event || ''), contentW - 28);
        doc.text(el, margin + 26, y);
        y += Math.max(el.length * 4, 5) + 3;
      });
      y += 3;
    }

    // ── KEY RISKS ─────────────────────────────────────────────────────────────
    if (a.key_risks?.length) {
      addSectionHeader('[RISKS]', 'Key Risks');
      a.key_risks.forEach(r => addBullet(r));
      y += 4;
    }

    // ── WATCH POINTS ──────────────────────────────────────────────────────────
    if (a.watch_points?.length) {
      addSectionHeader('[WATCH]', 'Watch Points');
      a.watch_points.forEach(w => addBullet(w));
      y += 4;
    }

    // ── LIVE HEADLINES ────────────────────────────────────────────────────────
    if (headlines.length) {
      addSectionHeader('[NEWS]', 'Live Headlines');
      headlines.slice(0, 6).forEach(hl => {
        checkPage(10);
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 40);
        const lines = doc.splitTextToSize('• ' + String(hl.title || ''), contentW - 4);
        doc.text(lines, margin + 2, y);
        y += lines.length * 4 + 2;
        if (hl.pubDate) {
          doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.setTextColor(120, 120, 140);
          doc.text(new Date(hl.pubDate).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}), margin + 4, y);
          y += 5;
        }
      });
    }

    // ── FOOTER ON EVERY PAGE ──────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(235, 230, 220);
      doc.rect(0, 283, W, 14, 'F');
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 110, 90);
      doc.text('BRIEFLY INTELLIGENCE  ·  AI-GENERATED — VERIFY WITH OFFICIAL SOURCES', margin, 290);
      doc.text('Page ' + i + ' of ' + pageCount, W - margin, 290, { align: 'right' });
    }

    // ── SAVE ──────────────────────────────────────────────────────────────────
    const filename = 'Briefly_' + topic.replace(/[^a-z0-9]/gi, '_').slice(0, 30) + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
    doc.save(filename);

  } catch(e) {
    console.error('PDF export error:', e);
    alert('PDF export failed: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📥 Export PDF'; }
  }
}


function generateBriefForce() {
  const q = document.getElementById('briefSearchInput').value.trim() || currentBriefTopic;
  if (!q) return;
  // Override the fetch to pass force:true
  const _orig = window._briefForce;
  window._briefForce = true;
  generateBrief().finally(() => { window._briefForce = false; });
}

async function loadAllAirspace() {
  if (!airspaceSelected.length) { document.getElementById('airspaceContent').innerHTML = ''; return; }
  if (!leafletMap) initMap();
  if (leafletMap) leafletMap.eachLayer(l => { if (l instanceof L.Marker) leafletMap.removeLayer(l); });
  const el = document.getElementById('airspaceContent');
  el.innerHTML = '<div style="display:grid;grid-template-columns:1fr;gap:14px;" id="airspaceGrid">'
    + airspaceSelected.map(c => '<div id="air_card_'+c.replace(/\s+/g,'_')+'"><div class="card"><div class="loading-state"><div class="loading-spinner"></div>Loading '+esc(c)+'…</div></div></div>').join('')
    + '</div>';
  airspaceSelected.forEach(c => loadSingleAirspace(c));
}

async function loadSingleAirspace(c) {
  const cardEl = document.getElementById('air_card_'+c.replace(/\s+/g,'_'));
  if (!cardEl) return;
  try {
    const data = await apiFetch('/api/airspace', { body: JSON.stringify({ country: c }) }, 'air_'+c, 10*60000);
    const lvl = data.alert_level || 'GREEN';
    const statusClass = {GREEN:'status-open',AMBER:'status-restricted',RED:'status-closed',BLACK:'status-conflict'}[lvl] || 'status-open';
    const statusLabel = {GREEN:'Open',AMBER:'Restricted',RED:'Closed',BLACK:'Conflict Zone'}[lvl] || 'Open';

    let notamHTML = '';
    if (data.notams?.length) {
      notamHTML = '<div class="notam-timeline-title">📋 Active NOTAMs</div>';
      notamHTML += data.notams.slice(0,5).map(n =>
        '<div class="notam-item">'+
          '<div class="notam-dot"></div>'+
          '<div class="notam-body">'+
            '<div class="notam-id">'+esc(n.id||'NOTAM')+'</div>'+
            '<div class="notam-title">'+esc(n.title||n.summary||'')+'</div>'+
            '<div class="notam-detail">'+esc(n.detail||n.description||'')+'</div>'+
            '<div class="notam-effective">'+esc(n.effective||n.validFrom||'')+(n.authority?' · '+esc(n.authority):'')+'</div>'+
          '</div>'+
        '</div>'
      ).join('');
    }

    let restrictHTML = '';
    if (data.restrictions?.length) {
      restrictHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">';
      data.restrictions.forEach(r => { restrictHTML += '<span class="restriction-tag">⚠ '+esc(r)+'</span>'; });
      restrictHTML += '</div>';
    }

    let linksHTML = '';
    if (showCitations && data.verifyLinks?.length) {
      linksHTML = '<div class="ac-links-row">'+
        data.verifyLinks.slice(0,4).map(l => '<a class="ac-link" href="'+esc(l.url)+'" target="_blank" rel="noopener">🔗 '+esc(l.label)+'</a>').join('')+
      '</div>';
    } else {
      const cc = (data.icao||c.slice(0,2)).toUpperCase();
      linksHTML = '<div class="ac-links-row">'+
        '<a class="ac-link" href="https://www.notams.faa.gov/dinsQueryWeb/" target="_blank" rel="noopener">🔗 FAA NOTAMs</a>'+
        '<a class="ac-link" href="https://www.flightradar24.com/" target="_blank" rel="noopener">🔗 FlightRadar24</a>'+
        '<a class="ac-link" href="https://ourairports.com/" target="_blank" rel="noopener">🔗 OurAirports</a>'+
      '</div>';
    }

    const h = '<div class="airspace-card '+statusClass+'">'+
      '<div class="airspace-card-header">'+
        '<div class="airspace-status-dot"></div>'+
        '<div class="ac-country">'+esc(data.country||c)+'</div>'+
        '<span class="ac-alert-badge alert-'+esc(lvl)+'">'+esc(lvl)+' · '+esc(statusLabel)+'</span>'+
        '<button onclick="removeAirspaceCountry(\''+esc(c)+'\');" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;margin-left:8px;opacity:.4;transition:opacity .2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.4">✕</button>'+
      '</div>'+
      '<div class="airspace-card-body">'+
        '<p style="font-size:13px;color:var(--muted);line-height:1.7;margin:0 0 10px;">'+esc(data.summary||'')+'</p>'+
        notamHTML + restrictHTML + linksHTML +
      '</div>'+
    '</div>';

    cardEl.innerHTML = h;
    const coords = COUNTRY_COORDS[c];
    if (coords && leafletMap) {
      const lvlColor = lvl==='GREEN'?'#4caf84':lvl==='AMBER'?'#ffc107':lvl==='RED'?'#e05c5c':'#ff4444';
      const icon = L.divIcon({ html: '<div style="width:14px;height:14px;background:'+lvlColor+';border:2px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.4);"></div>', iconSize:[14,14],iconAnchor:[7,7],className:'' });
      L.marker(coords,{icon}).addTo(leafletMap).bindPopup('<strong>'+c+'</strong><br/>'+lvl+' · '+statusLabel);
    }
  } catch(e) {
    cardEl.innerHTML = '<div class="airspace-card"><div class="airspace-card-body"><div class="error-state-msg">⚠ '+esc(e.message)+'</div></div></div>';
  }
}
document.getElementById('airspaceSearchInput').addEventListener('keydown', e => { if (e.key==='Enter') addAirspaceCountry(); });

// ── ADVISORIES MULTI-SELECT (up to 7) ────────────────────────────────────────
let advisorySelected = [];
let airspaceSelected = [];

function renderAdvisoryTags() {
  const el = document.getElementById('advisorySelectedTags');
  if (!el) return;
  el.innerHTML = advisorySelected.map(c =>
    '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;background:var(--text);color:var(--bg);border-radius:20px;font-family:var(--cond);font-size:11px;font-weight:700;">'
    +esc(c)+'<button onclick="removeAdvisoryCountry(\''+esc(c)+'\');" style="background:none;border:none;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0 0 0 3px;opacity:.7;">✕</button></span>'
  ).join('');
  document.querySelectorAll('#tab-advisories .chip').forEach(ch => {
    const country = ch.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (country) ch.classList.toggle('active', advisorySelected.includes(country));
  });
}

function addAdvisoryCountry(country) {
  const c = country || document.getElementById('advisorySearchInput').value.trim();
  if (!c) return;
  if (advisorySelected.includes(c)) { loadAllAdvisories(); return; }
  if (advisorySelected.length >= 7) { alert('Maximum 7 countries selected. Remove one first.'); return; }
  advisorySelected.push(c);
  document.getElementById('advisorySearchInput').value = '';
  renderAdvisoryTags();
  loadAllAdvisories();
}

function removeAdvisoryCountry(c) {
  advisorySelected = advisorySelected.filter(x => x !== c);
  renderAdvisoryTags();
  renderAdvisoryGrid();
}

function toggleAdvisoryChip(btn, country) {
  if (advisorySelected.includes(country)) removeAdvisoryCountry(country);
  else addAdvisoryCountry(country);
}

function clearAdvisorySelections() {
  advisorySelected = [];
  renderAdvisoryTags();
  document.getElementById('advisoryContent').innerHTML = '';
}

function renderAdvisoryGrid() {
  const el = document.getElementById('advisoryContent');
  if (!advisorySelected.length) { el.innerHTML = ''; return; }
  el.innerHTML = advisorySelected.map(c => '<div id="adv_card_'+c.replace(/\s+/g,'_')+'"></div>').join('');
  advisorySelected.forEach(c => {
    const cached = cacheGet('adv_'+c, 15*60000);
    if (cached) renderAdvisoryCard(c, cached);
    else loadSingleAdvisory(c);
  });
}

function addAirspaceCountry(country) {
  const c = country || document.getElementById('airspaceSearchInput')?.value.trim();
  if (!c) return;
  if (airspaceSelected.includes(c)) { loadAllAirspace(); return; }
  if (airspaceSelected.length >= 7) { showToast('Maximum 7 countries. Remove one first.', 'warning'); return; }
  airspaceSelected.push(c);
  LS.set('airspaceSelected', airspaceSelected);
  const inp = document.getElementById('airspaceSearchInput');
  if (inp) inp.value = '';
  renderAirspaceTags();
  loadAllAirspace();
}

function removeAirspaceCountry(country) {
  airspaceSelected = airspaceSelected.filter(c => c !== country);
  LS.set('airspaceSelected', airspaceSelected);
  renderAirspaceTags();
  loadAllAirspace();
  if (leafletMap) {
    leafletMap.eachLayer(l => { if (l instanceof L.Marker) leafletMap.removeLayer(l); });
  }
}

function clearAirspaceSelections() {
  airspaceSelected = [];
  LS.set('airspaceSelected', []);
  renderAirspaceTags();
  const el = document.getElementById('airspaceContent');
  if (el) el.innerHTML = '';
  if (leafletMap) {
    leafletMap.eachLayer(l => { if (l instanceof L.Marker) leafletMap.removeLayer(l); });
  }
}

function renderAirspaceTags() {
  const el = document.getElementById('airspaceSelectedTags');
  if (!el) return;
  el.innerHTML = airspaceSelected.map(c =>
    '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;background:var(--text);color:var(--bg);border-radius:20px;font-family:var(--cond);font-size:11px;font-weight:700;">'
    + esc(c)
    + '<button onclick="removeAirspaceCountry(\''+esc(c)+'\');" style="background:none;border:none;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 0 0 2px;">×</button>'
    + '</span>'
  ).join('');
}

async function loadAllAdvisories() {
  const el = document.getElementById('advisoryContent');
  if (!advisorySelected.length) { el.innerHTML = ''; return; }
  // Render all skeletons instantly
  el.innerHTML = advisorySelected.map(c =>
    '<div id="adv_card_'+c.replace(/[^a-zA-Z0-9]/g,'_')+'">'+
    '<div class="adv-card" style="padding:18px 20px;">'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">'+
    '<div style="width:120px;height:14px;background:var(--border);border-radius:4px;animation:shimmer 1.4s ease infinite;"></div>'+
    '</div>'+
    '<div style="width:100%;height:8px;background:var(--border);border-radius:4px;margin-bottom:8px;animation:shimmer 1.4s ease infinite;"></div>'+
    '<div style="width:80%;height:8px;background:var(--border);border-radius:4px;animation:shimmer 1.4s ease infinite;"></div>'+
    '</div></div>'
  ).join('');
  // Load all in parallel
  Promise.all(advisorySelected.map(c => loadSingleAdvisory(c)));
}

async function loadSingleAdvisory(c) {
  const cardId = 'adv_card_' + c.replace(/[^a-zA-Z0-9]/g,'_');
  const wrapper = document.getElementById(cardId);
  try {
    const data = await apiFetch('/api/advisories', { body: JSON.stringify({ country: c }) }, 'adv_'+c, 15*60000);
    // Build country object from string name + data
    const countryObj = {
      name: c,
      code: data.country_code || data.code || c.slice(0,2).toUpperCase(),
      flag: data.flag || getFlagEmoji(data.country_code || c.slice(0,2).toUpperCase())
    };
    const html = renderAdvisoryCard(countryObj, data);
    if (wrapper) wrapper.innerHTML = html;
  } catch(e) {
    if (wrapper) wrapper.innerHTML = '<div class="adv-card"><div class="error-state" style="padding:20px;">⚠ Failed to load '+esc(c)+': '+esc(e.message)+'</div></div>';
  }
}

function getFlagEmoji(code) {
  if (!code || code.length !== 2) return '';
  try {
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)));
  } catch(e) { return ''; }
}

function riskColor(score) {
  if (score >= 75) return '#e05c5c';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffc107';
  return '#4caf84';
}

function advLevelClass(level) {
  const l = parseInt(level) || 1;
  return ['','adv-l1','adv-l2','adv-l3','adv-l4'][l] || 'adv-l2';
}

function advLevelLabel(level, country) {
  const l = parseInt(level) || 2;
  const labels = {1:'Exercise Normal Caution', 2:'Exercise Increased Caution', 3:'Reconsider Travel', 4:'Do Not Travel'};
  return labels[l] || 'Exercise Caution';
}

function renderAdvisoryCard(country, data) {
  const level = data.level || data.advisoryLevel || 2;
  const lClass = advLevelClass(level);
  const lLabel = advLevelLabel(level, country.name);
  const flag = country.flag || '';
  const risks = data.risks || { security: 50, crime: 40, health: 30, natural: 20 };
  const riskKeys = Object.keys(risks).slice(0,5);

  const riskBars = riskKeys.map(k => {
    const score = risks[k] || 0;
    const color = riskColor(score);
    return '<div class="adv-risk-row">'+
      '<div class="adv-risk-label">'+esc(k)+'</div>'+
      '<div class="adv-risk-bar-bg"><div class="adv-risk-bar-fill" style="width:'+score+'%;background:'+color+';"></div></div>'+
      '<div class="adv-risk-score">'+score+'</div>'+
    '</div>';
  }).join('');

  const details = [];
  if (data.summary) details.push(['Advisory', data.summary.slice(0,120)+(data.summary.length>120?'…':'')]);
  if (data.entryRequirements || data.entry) details.push(['Entry Requirements', (data.entryRequirements||data.entry||'').slice(0,100)+'…']);
  if (data.safetyTips || data.tips) details.push(['Safety Tips', (data.safetyTips||data.tips||'').slice(0,100)+'…']);
  if (data.emergencyContact || data.emergency) details.push(['Emergency', data.emergencyContact||data.emergency||'']);

  const detailHTML = details.map(([label, val]) =>
    '<div class="adv-detail-block"><div class="adv-detail-label">'+esc(label)+'</div><div class="adv-detail-val">'+esc(val)+'</div></div>'
  ).join('');

  const cc = country.code || '';
  const sources = [
    ['🇺🇸 State Dept', 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/'+cc.toLowerCase()+'-travel-advisory.html'],
    ['🇬🇧 FCDO', 'https://www.gov.uk/foreign-travel-advice/'+cc.toLowerCase()],
  ];
  const srcHTML = sources.map(([label, url]) =>
    '<a class="adv-source-link" href="'+url+'" target="_blank" rel="noopener">'+esc(label)+'</a>'
  ).join('');

  return '<div class="adv-card">'+
    '<div class="adv-card-header">'+
      '<div class="adv-flag">'+flag+'</div>'+
      '<div class="adv-header-text">'+
        '<div class="adv-country-name">'+esc(country.name)+'</div>'+
        '<div class="adv-level-badge '+lClass+'">Level '+level+' — '+esc(lLabel)+'</div>'+
      '</div>'+
      '<button class="adv-remove-btn" onclick="removeAdvisoryCountry(\''+esc(country.code)+'\')" title="Remove">✕</button>'+
    '</div>'+
    '<div class="adv-card-body">'+
      (riskBars ? '<div>'+riskBars+'</div>' : '')+
      (detailHTML ? '<div class="adv-detail-grid">'+detailHTML+'</div>' : '')+
      '<div class="adv-sources-row">'+srcHTML+'</div>'+
    '</div>'+
  '</div>';
}


// ── MARKETS HELPERS ─────────────────────────────────────────────
function makeSparkline(changePercent, up) {
  const w = 100, h = 28, pts = 20;
  const rng = Math.abs(changePercent || 1) * 0.4 + 0.3;
  let prices = [50];
  for (let i = 1; i < pts; i++) prices.push(prices[i-1] + (Math.random()-0.48) * rng * 4);
  prices[pts-1] = prices[pts-2] + (up ? Math.abs(changePercent||1)*0.7 : -Math.abs(changePercent||1)*0.7);
  const mn = Math.min(...prices), mx = Math.max(...prices);
  const sy = v => (h - ((v-mn)/(mx-mn||1)) * (h-4) - 2);
  const sx = i => (i/(pts-1)) * w;
  const d = prices.map((p,i)=>(i===0?'M':'L')+sx(i).toFixed(1)+','+sy(p).toFixed(1)).join(' ');
  const color = up ? '#4caf84' : '#e05c5c';
  return '<svg class="tc-sparkline" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/></svg>';
}

let WATCHLIST = [];
try { WATCHLIST = JSON.parse(localStorage.getItem('briefly_watchlist') || '[]'); } catch(e) {}

function buildTickerCard(q, name, up, pr, pct, chg, isAI, realPrices) {
  const sym = q.symbol.split('.')[0].replace('^','');
  const isWatched = WATCHLIST.includes(sym);
  const sourceBadge = isAI ? '<span class="tc-badge tc-badge-ai">AI Est.</span>' :
    (q.source === 'twelvedata' ? '<span class="tc-badge tc-badge-live">&#x25CF; LIVE</span>' :
    '<span class="tc-badge tc-badge-yahoo">Yahoo</span>');
  const watchTitle = isWatched ? 'Remove from watchlist' : 'Add to watchlist';
  const watchIcon = isWatched ? '&#x2605;' : '&#x2606;';
  return '<div class="ticker-card'+(isWatched?' watchlisted':'')+'" id="tc-'+sym+'" data-sym="'+sym+'" data-name="'+esc(name)+'" onclick="openChartModal(this.dataset.sym,this.dataset.name)" style="cursor:pointer">' +
    '<button class="tc-watch-btn'+(isWatched?' active':'')+'" onclick="event.stopPropagation();toggleWatch(\''+sym+'\')" title="'+watchTitle+'">'+watchIcon+'</button>' +
    '<div class="tc-symbol">'+esc(sym)+'</div>' +
    '<div class="tc-name">'+esc(name)+'</div>' +
    makeSparkline(q.changePercent, up, realPrices) +
    '<div class="tc-price '+(up?'tc-up':'tc-down')+'">'+pr+'</div>' +
    '<div class="tc-change '+(up?'tc-up':'tc-down')+'">'+pct+(chg?' ('+chg+')':'')+'</div>' +
    sourceBadge +
    '</div>';
}
function toggleWatch(sym) {
  const idx = WATCHLIST.indexOf(sym);
  if (idx > -1) WATCHLIST.splice(idx, 1); else WATCHLIST.push(sym);
  try { localStorage.setItem('briefly_watchlist', JSON.stringify(WATCHLIST)); } catch(e) {}
  // Update all instances
  document.querySelectorAll('[id^="tc-'+sym+'"]').forEach(card => {
    card.classList.toggle('watchlisted', WATCHLIST.includes(sym));
    const btn = card.querySelector('.tc-watch-btn');
    if (btn) {
      btn.textContent = WATCHLIST.includes(sym) ? '★' : '☆';
      btn.classList.toggle('active', WATCHLIST.includes(sym));
    }
  });
  updateWatchlistSection();
}

function updateWatchlistSection() {
  const sec = document.getElementById('watchlistSection');
  const grid = document.getElementById('watchlistGrid');
  if (!sec || !grid) return;
  if (!WATCHLIST.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  grid.innerHTML = WATCHLIST.map(sym => {
    const orig = document.getElementById('tc-'+sym);
    if (!orig) return '<div style="font-family:var(--cond);font-size:11px;color:var(--muted);padding:8px;">'+esc(sym)+'</div>';
    const clone = orig.cloneNode(true);
    clone.id = 'wl-'+sym;
    return clone.outerHTML;
  }).join('') || '<div class="watchlist-empty">No items yet</div>';
}

function updateMarketsSummaryBar(quotes) {
  const symbolMap = {
    'GSPC':'sp500','DJI':'dow','IXIC':'nasdaq','IXIC':'nasdaq',
    'GC=F':'gold','CL=F':'oil','BTC-USD':'btc','BTC':'btc'
  };
  quotes.forEach(q => {
    const sym = (q.symbol||'').replace('^','').toUpperCase();
    const key = Object.keys(symbolMap).find(k => sym.includes(k.replace('^','')));
    if (!key) return;
    const id = symbolMap[key];
    const valEl = document.getElementById('ms-'+id);
    const chgEl = document.getElementById('ms-'+id+'c');
    if (!valEl || !chgEl) return;
    const up = (q.change||0) >= 0;
    const pr = q.price != null ? q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    const pct = q.changePercent != null ? (up?'+':'')+q.changePercent.toFixed(2)+'%' : '—';
    valEl.textContent = pr;
    chgEl.textContent = pct;
    chgEl.className = 'mkt-summary-chg '+(up?'up':'dn');
  });
}


const MARKET_GROUPS = [
  { id: 'us',         label: 'United States', symbols: '^GSPC,^DJI,^IXIC,^RUT',
    names: { '^GSPC':'S&P 500','^DJI':'Dow Jones','^IXIC':'Nasdaq','^RUT':'Russell 2000' } },
  { id: 'europe',     label: 'Europe', symbols: '^FTSE,^GDAXI,^FCHI,^IBEX',
    names: { '^FTSE':'FTSE 100','^GDAXI':'DAX','^FCHI':'CAC 40','^IBEX':'IBEX 35' } },
  { id: 'asia',       label: 'Asia', symbols: '^N225,^HSI,^AXJO,000001.SS',
    names: { '^N225':'Nikkei 225','^HSI':'Hang Seng','^AXJO':'ASX 200','000001.SS':'Shanghai' } },
  { id: 'mideast',    label: 'Middle East', symbols: '^TASI,^DFMGI,^KWSE',
    names: { '^TASI':'Tadawul (Saudi)','^DFMGI':'DFM (Dubai)','^KWSE':'Kuwait SE' } },
  { id: 'commodities',label: 'Commodities', symbols: 'GC=F,CL=F,BZ=F,SI=F,NG=F',
    names: { 'GC=F':'Gold','CL=F':'WTI Crude','BZ=F':'Brent Crude','SI=F':'Silver','NG=F':'Natural Gas' } },
];

function loadMarkets(force) {
  if (force) { MARKET_GROUPS.forEach(g => { delete CACHE['mkt_'+g.id]; }); delete CACHE['mkt_commentary']; marketsLoaded = false; }
  marketsLoaded = true;
  MARKET_GROUPS.forEach(g => loadMarketGroup(g));
  loadMarketCommentary();
  setTimeout(updateWatchlistSection, 2000);
}

async function loadMarketGroup(g) {
  const el = document.getElementById('ticker-'+g.id);
  if (!el) return;
  // Show loading skeletons
  el.innerHTML = g.symbols.split(',').map(s => {
    const sym = s.trim().replace('^','').replace('=F','').replace('-USD','').replace('=X','');
    return '<div class="ticker-card" id="tc-'+sym+'_loading"><div class="tc-symbol">'+sym+'</div><div class="loading-spinner" style="width:14px;height:14px;margin:8px 0;"></div></div>';
  }).join('');
  try {
    const data = await apiFetch('/api/markets/quote?symbols='+encodeURIComponent(g.symbols),
      { method: 'GET' }, 'mkt_'+g.id, CACHE_TTL.markets);
    const quotes = data.quotes || [];
    const isAI = data.source === 'ai_estimate';
    updateMarketsSummaryBar(quotes);

    el.innerHTML = quotes.map(q => {
      const name = g.names[q.symbol] || q.name || q.symbol;
      const up = (q.change || 0) >= 0;
      const pr = q.price != null
        ? (q.price >= 1000 ? q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
          : q.price.toFixed(q.price < 10 ? 4 : 2))
        : '—';
      const pct = q.changePercent != null ? (up?'+':'')+q.changePercent.toFixed(2)+'%' : '—';
      const chg = q.change != null ? (up?'+':'')+q.change.toFixed(2) : '';
      return buildTickerCard(q, name, up, pr, pct, chg, isAI, null);
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="error-state" style="padding:16px;">⚠ Failed to load '+esc(g.label)+'</div>';
  }
}

async function loadMarketCommentary() {
  const el = document.getElementById('marketCommentary');
  try {
    const data = await apiFetch('/api/markets/commentary', {}, 'mkt_commentary', CACHE_TTL.markets);
    let html = '';
    if (data.headline) html += '<div style="font-family:var(--serif);font-size:18px;font-weight:700;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">'+esc(data.headline)+'</div>';
    const items = [
      {icon:'🌍',label:'Overview',key:'summary'},
      {icon:'🇺🇸',label:'US Markets',key:'us_commentary'},
      {icon:'🌍',label:'Europe',key:'europe_commentary'},
      {icon:'🌏',label:'Asia',key:'asia_commentary'},
      {icon:'🌙',label:'Middle East',key:'mideast_commentary'},
      {icon:'🛢️',label:'Crude Oil',key:'oil_commentary'},
      {icon:'🥇',label:'Gold',key:'gold_commentary'},
      {icon:'💱',label:'FX',key:'fx_commentary'},
    ];
    items.forEach(item => {
      if (data[item.key]) {
        html += '<div class="commentary-item"><div class="ci-icon">'+item.icon+'</div><div>';
        html += '<div class="ci-label">'+item.label+'</div>';
        html += '<div class="ci-text">'+esc(data[item.key])+'</div></div></div>';
      }
    });
    if (showCitations && data.sources?.length) {
      html += '<div class="citation-bar" style="margin-top:12px;">📎 ';
      data.sources.forEach(s => { html += '<a class="citation-link" href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.name)+'</a> '; });
      html += '</div>';
    }
    if (showAiBadge) html += '<div style="margin-top:12px;"><span class="ai-badge">🤖 AI Analysis</span></div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-state">⚠ Commentary unavailable: '+esc(e.message)+'</div>';
  }
}

async function loadBreakingTicker() {
  try {
    const data = await apiFetch('/api/rss/breaking', { method:'GET' }, 'breaking', 5*60000);
    const items = data.items || [];
    if (!items.length) return;
    const track = document.getElementById('tickerTrack');
    const doubled = [...items, ...items];
    track.innerHTML = doubled.map(item => {
      const lk = item.link ? 'href="'+esc(item.link)+'" target="_blank" rel="noopener"' : '';
      return '<a '+lk+'>'+esc(item.source ? '['+item.source+'] ' : '')+esc(item.title)+'</a>';
    }).join('');
  } catch (e) { /* silent */ }
}

let pressLoading = false;
async function loadPress(region) {
  if (pressLoading) return;
  if (!region) {
    const sel = document.getElementById('pressCountrySelect');
    region = sel ? sel.value : 'Global/World';
  }
  currentPressRegion = region;
  const el = document.getElementById('pressContent');
  showLoading(el, 'Loading official statements for '+region+'…');
  pressLoading = true;
  try {
    const data = await apiFetch('/api/press-releases', { body: JSON.stringify({ region }) }, 'press_'+region, 20*60000);
    const releases = data.releases || [];
    if (!releases.length) { el.innerHTML = '<div style="color:var(--muted);padding:20px;">No releases found.</div>'; return; }
    el.innerHTML = releases.map(r => {
      const cat = (r.category||'').replace(/\s+/g,'-');
      let dateStr = '';
      if (r.publishedTime || r.date) {
        dateStr = (r.date || '') + (r.publishedTime ? ' · ' + r.publishedTime : '');
      } else if (r.publishedAt || r.timestamp) {
        try {
          const d = new Date(r.publishedAt || r.timestamp);
          if (!isNaN(d)) dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' · '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
        } catch(e) {}
      }
      return '<div class="press-card cat-'+esc(cat)+'">'
        +'<div class="press-country"><div class="press-flag-name">'+esc(r.flag||'')+'  '+esc(r.country||'')+'</div><div class="press-category">'+esc(r.category||'')+'</div></div>'
        +'<div class="press-ministry">'+esc(r.ministry||'')+'</div>'
        +'<div class="press-title">'+esc(r.title)+'</div>'
        +'<div class="press-summary">'+esc(r.summary)+'</div>'
        +'<div class="press-footer" style="display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap;">'
        +(dateStr ? '<span style="font-size:11px;color:var(--muted);font-family:var(--cond);">🕐 '+esc(dateStr)+'</span>' : (r.date||r.publishedTime ? '<span style="font-size:11px;color:var(--muted);font-family:var(--cond);">🕐 '+esc((r.date||'')+' '+(r.publishedTime||''))+'</span>' : ''))
        +(r.sourceUrl ? '<a href="'+esc(r.sourceUrl)+'" target="_blank" rel="noopener" style="font-size:11px;color:var(--gold);font-family:var(--cond);font-weight:700;text-decoration:none;letter-spacing:.04em;">↗ '+esc(r.source||'Source')+'</a>' : (r.source ? '<span style="font-size:11px;color:var(--muted);font-family:var(--cond);">'+esc(r.source)+'</span>' : ''))
        +'</div>'
        +'</div>';
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="error-state">⚠ Failed to load press releases: '+esc(e.message)+' <button class="error-retry" onclick="loadPress(currentPressRegion)">Retry</button></div>';
  } finally { pressLoading = false; }
}

function selectPressRegion(btn, region) {
  if (btn) {
    document.querySelectorAll('#pressRegionPills .pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  delete CACHE['press_'+region];
  loadPress(region);
}

// ── SEARCHABLE PRESS DROPDOWN ─────────────────────────────────────────────────
const PRESS_OPTIONS = [
  { group:'Regions', value:'Global/World', label:'🌍 Global / World' },
  { group:'Regions', value:'North America', label:'🌎 North America' },
  { group:'Regions', value:'Europe', label:'🌍 Europe' },
  { group:'Regions', value:'Middle East & Africa', label:'🌙 Middle East & Africa' },
  { group:'Regions', value:'Asia', label:'🌏 Asia' },
  { group:'Regions', value:'South America', label:'🌎 South America' },
  { group:'North America', value:'United States', label:'🇺🇸 United States' },
  { group:'North America', value:'Canada', label:'🇨🇦 Canada' },
  { group:'North America', value:'Mexico', label:'🇲🇽 Mexico' },
  { group:'Europe', value:'United Kingdom', label:'🇬🇧 United Kingdom' },
  { group:'Europe', value:'France', label:'🇫🇷 France' },
  { group:'Europe', value:'Germany', label:'🇩🇪 Germany' },
  { group:'Europe', value:'Italy', label:'🇮🇹 Italy' },
  { group:'Europe', value:'Spain', label:'🇪🇸 Spain' },
  { group:'Europe', value:'Poland', label:'🇵🇱 Poland' },
  { group:'Europe', value:'Netherlands', label:'🇳🇱 Netherlands' },
  { group:'Europe', value:'Sweden', label:'🇸🇪 Sweden' },
  { group:'Europe', value:'Norway', label:'🇳🇴 Norway' },
  { group:'Europe', value:'Ukraine', label:'🇺🇦 Ukraine' },
  { group:'Europe', value:'Turkey', label:'🇹🇷 Turkey' },
  { group:'Middle East', value:'Saudi Arabia', label:'🇸🇦 Saudi Arabia' },
  { group:'Middle East', value:'United Arab Emirates', label:'🇦🇪 UAE' },
  { group:'Middle East', value:'Israel', label:'🇮🇱 Israel' },
  { group:'Middle East', value:'Iran', label:'🇮🇷 Iran' },
  { group:'Middle East', value:'Iraq', label:'🇮🇶 Iraq' },
  { group:'Middle East', value:'Jordan', label:'🇯🇴 Jordan' },
  { group:'Middle East', value:'Lebanon', label:'🇱🇧 Lebanon' },
  { group:'Middle East', value:'Qatar', label:'🇶🇦 Qatar' },
  { group:'Middle East', value:'Kuwait', label:'🇰🇼 Kuwait' },
  { group:'Middle East', value:'Bahrain', label:'🇧🇭 Bahrain' },
  { group:'Middle East', value:'Oman', label:'🇴🇲 Oman' },
  { group:'Middle East', value:'Egypt', label:'🇪🇬 Egypt' },
  { group:'Middle East', value:'Syria', label:'🇸🇾 Syria' },
  { group:'Middle East', value:'Yemen', label:'🇾🇪 Yemen' },
  { group:'Middle East', value:'Libya', label:'🇱🇾 Libya' },
  { group:'Africa', value:'South Africa', label:'🇿🇦 South Africa' },
  { group:'Africa', value:'Nigeria', label:'🇳🇬 Nigeria' },
  { group:'Africa', value:'Kenya', label:'🇰🇪 Kenya' },
  { group:'Africa', value:'Ethiopia', label:'🇪🇹 Ethiopia' },
  { group:'Africa', value:'Morocco', label:'🇲🇦 Morocco' },
  { group:'Africa', value:'Algeria', label:'🇩🇿 Algeria' },
  { group:'Africa', value:'Sudan', label:'🇸🇩 Sudan' },
  { group:'Asia', value:'China', label:'🇨🇳 China' },
  { group:'Asia', value:'Japan', label:'🇯🇵 Japan' },
  { group:'Asia', value:'India', label:'🇮🇳 India' },
  { group:'Asia', value:'South Korea', label:'🇰🇷 South Korea' },
  { group:'Asia', value:'North Korea', label:'🇰🇵 North Korea' },
  { group:'Asia', value:'Pakistan', label:'🇵🇰 Pakistan' },
  { group:'Asia', value:'Afghanistan', label:'🇦🇫 Afghanistan' },
  { group:'Asia', value:'Bangladesh', label:'🇧🇩 Bangladesh' },
  { group:'Asia', value:'Indonesia', label:'🇮🇩 Indonesia' },
  { group:'Asia', value:'Vietnam', label:'🇻🇳 Vietnam' },
  { group:'Asia', value:'Thailand', label:'🇹🇭 Thailand' },
  { group:'Asia', value:'Philippines', label:'🇵🇭 Philippines' },
  { group:'Asia', value:'Myanmar', label:'🇲🇲 Myanmar' },
  { group:'Asia', value:'Taiwan', label:'🇹🇼 Taiwan' },
  { group:'South America', value:'Brazil', label:'🇧🇷 Brazil' },
  { group:'South America', value:'Argentina', label:'🇦🇷 Argentina' },
  { group:'South America', value:'Colombia', label:'🇨🇴 Colombia' },
  { group:'South America', value:'Chile', label:'🇨🇱 Chile' },
  { group:'South America', value:'Venezuela', label:'🇻🇪 Venezuela' },
  { group:'South America', value:'Peru', label:'🇵🇪 Peru' },
  { group:'Oceania', value:'Australia', label:'🇦🇺 Australia' },
  { group:'Oceania', value:'New Zealand', label:'🇳🇿 New Zealand' },
  { group:'Other', value:'Russia', label:'🇷🇺 Russia' },
  { group:'Other', value:'NATO', label:'🌐 NATO' },
  { group:'Other', value:'European Union', label:'🇪🇺 European Union' },
  { group:'Other', value:'United Nations', label:'🌐 United Nations' },
];

let pressDropdownOpen = false;
let pressHighlightIdx = -1;

function renderPressDropdown(filtered) {
  const dd = document.getElementById('pressDropdown');
  if (!dd) return;
  const groups = {};
  filtered.forEach(o => { (groups[o.group] = groups[o.group]||[]).push(o); });
  let h = '', flatIdx = 0;
  const flatList = [];
  Object.entries(groups).forEach(([g, opts]) => {
    h += '<div style="padding:6px 14px 3px;font-family:var(--cond);font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--border);margin-top:2px;">'+esc(g)+'</div>';
    opts.forEach(o => {
      const active = o.value === currentPressRegion;
      h += '<div class="press-dd-item" data-value="'+esc(o.value)+'" data-idx="'+flatList.length+'" style="padding:8px 16px;cursor:pointer;font-size:13px;color:var(--text);'+(active?'background:var(--bg2);font-weight:600;':'')+'" onmousedown="selectPressOption(\''+esc(o.value)+'\',\''+esc(o.label)+'\')" onmouseover="highlightPressItem('+flatList.length+')">'
        + o.label + (active ? ' <span style="float:right;color:var(--gold);">✓</span>' : '') + '</div>';
      flatList.push(o);
    });
  });
  if (!filtered.length) h = '<div style="padding:14px 16px;color:var(--muted);font-size:13px;">No matches</div>';
  dd.innerHTML = h;
  dd._flatList = flatList;
}

function openPressDropdown() {
  const dd = document.getElementById('pressDropdown');
  const box = document.getElementById('pressSearchBox');
  if (!dd || !box) return;
  pressDropdownOpen = true;
  dd.style.display = 'block';
  box.style.borderColor = 'var(--gold)';
  box.style.background = 'var(--card)';
  renderPressDropdown(PRESS_OPTIONS);
}

function closePressDropdown() {
  const dd = document.getElementById('pressDropdown');
  const box = document.getElementById('pressSearchBox');
  if (dd) dd.style.display = 'none';
  if (box) { box.style.borderColor = ''; box.style.background = ''; }
  pressDropdownOpen = false;
  pressHighlightIdx = -1;
  // restore display value
  const inp = document.getElementById('pressSearchInput');
  if (inp) {
    const opt = PRESS_OPTIONS.find(o => o.value === currentPressRegion);
    inp.value = opt ? opt.label.replace(/^\S+\s/,'') : currentPressRegion;
  }
}

function togglePressDropdown() {
  if (pressDropdownOpen) closePressDropdown();
  else { document.getElementById('pressSearchInput')?.focus(); openPressDropdown(); }
}

function filterPressDropdown() {
  const q = (document.getElementById('pressSearchInput')?.value||'').toLowerCase();
  const filtered = q ? PRESS_OPTIONS.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q) || o.group.toLowerCase().includes(q)) : PRESS_OPTIONS;
  renderPressDropdown(filtered);
  pressHighlightIdx = -1;
}

function selectPressOption(value, label) {
  currentPressRegion = value;
  const inp = document.getElementById('pressSearchInput');
  if (inp) inp.value = label.replace(/^\S+\s/,'');
  closePressDropdown();
  delete CACHE['press_'+value];
  loadPress(value);
}

function highlightPressItem(idx) {
  pressHighlightIdx = idx;
  document.querySelectorAll('.press-dd-item').forEach((el,i) => {
    el.style.background = i===idx ? 'var(--bg2)' : (el.dataset.value===currentPressRegion?'var(--bg2)':'');
  });
}

function pressDdKeydown(e) {
  const dd = document.getElementById('pressDropdown');
  if (!pressDropdownOpen) { if (e.key==='ArrowDown'||e.key==='Enter') openPressDropdown(); return; }
  const items = dd?._flatList || [];
  if (e.key==='ArrowDown') { e.preventDefault(); pressHighlightIdx=Math.min(pressHighlightIdx+1,items.length-1); highlightPressItem(pressHighlightIdx); }
  else if (e.key==='ArrowUp') { e.preventDefault(); pressHighlightIdx=Math.max(pressHighlightIdx-1,0); highlightPressItem(pressHighlightIdx); }
  else if (e.key==='Enter') { e.preventDefault(); if (pressHighlightIdx>=0&&items[pressHighlightIdx]) selectPressOption(items[pressHighlightIdx].value, items[pressHighlightIdx].label); }
  else if (e.key==='Escape') closePressDropdown();
}

function onPressSelectChange() {
  const sel = document.getElementById('pressCountrySelect');
  if (!sel) return;
  selectPressOption(sel.value, sel.options[sel.selectedIndex]?.text||sel.value);
}

document.addEventListener('click', e => {
  if (pressDropdownOpen && !e.target.closest('#pressSearchWrap')) closePressDropdown();
});

function refreshPress() {
  const sel = document.getElementById('pressCountrySelect');
  const r = sel ? sel.value : currentPressRegion;
  delete CACHE['press_'+r];
  loadPress(r);
}

// ── CHAT FUNCTIONS ────────────────────────────────────────────
const CHAT_SUGGESTIONS = [
  'What caused the Gaza conflict?','Explain US-China trade tensions',
  'What is happening in Sudan?','Ukraine war latest developments',
  'Iran nuclear deal status','Who are the Houthis?',
  'Taiwan strait tensions explained','What are BRICS nations?'
];

function chatSuggest(el) {
  const q = el.textContent.trim();
  const inp = document.getElementById('chatInput');
  if (inp) { inp.value = q; }
  sendChat();
}

function clearChat() {
  chatHistory = [];
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  msgs.innerHTML = '<div class="chat-welcome" id="chatWelcomeNew"><div class="chat-welcome-icon">🌐</div><div class="chat-welcome-title">Intelligence Q&A</div><div class="chat-welcome-desc">Ask anything about global events, conflicts, geopolitics, or countries. I have access to live web search.</div><div class="chat-welcome-chips">' +
    CHAT_SUGGESTIONS.slice(0,4).map(s=>'<span class="chat-welcome-chip" onclick="chatSuggest(this)">'+esc(s)+'</span>').join('') +
  '</div></div>';
}

function chatTimestamp() {
  return new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true});
}

function renderMarkdownChat(text) {
  let t = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  t = t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g,'<em>$1</em>');
  t = t.replace(/`(.+?)`/g,'<code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:12px;">$1</code>');
  t = t.replace(/^### (.+)$/gm,'<div style="font-family:var(--cond);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(200,168,75,0.7);margin:10px 0 4px;">$1</div>');
  t = t.replace(/^## (.+)$/gm,'<div style="font-family:var(--cond);font-size:13px;font-weight:800;letter-spacing:.06em;color:var(--gold);margin:12px 0 6px;">$1</div>');
  t = t.replace(/^[•\-] (.+)$/gm,'<div style="padding-left:12px;margin:2px 0;">• $1</div>');
  t = t.replace(/\n\n/g,'<br/><br/>').replace(/\n/g,'<br/>');
  return t;
}

async function sendChat() {
  const inp = document.getElementById('chatInput');
  const btn = document.getElementById('chatSendBtn');
  const q = inp ? inp.value.trim() : '';
  if (!q || (btn && btn.disabled)) return;
  if (inp) inp.value = '';
  if (btn) btn.disabled = true;
  document.getElementById('chatWelcome')?.remove();
  const msgs = document.getElementById('chatMessages');
  if (!msgs) { if (btn) btn.disabled = false; return; }
  const ts = chatTimestamp();
  msgs.innerHTML += '<div class="chat-msg user"><div class="chat-bubble user">'+esc(q)+'</div><div class="chat-meta">'+ts+'</div></div>';
  const typingId = 'typing_'+Date.now();
  msgs.innerHTML += '<div class="chat-msg assistant" id="'+typingId+'"><div class="chat-bubble assistant typing"><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div></div>';
  msgs.scrollTop = msgs.scrollHeight;
  chatHistory.push({ role: 'user', content: q });
  try {
    const data = await apiFetch('/api/ask', { body: JSON.stringify({ question: q, history: chatHistory.slice(-8) }) });
    document.getElementById(typingId)?.remove();
    const answer = data.answer || 'No response.';
    chatHistory.push({ role: 'assistant', content: answer });
    const msgId = 'msg_'+Date.now();
    msgs.innerHTML += '<div class="chat-msg assistant" id="'+msgId+'">'+
      '<div class="chat-bubble assistant">'+renderMarkdownChat(answer)+'</div>'+
      '<div class="chat-actions">'+
        '<div class="chat-meta">Briefly Intelligence · '+chatTimestamp()+'</div>'+
        '<button class="chat-copy-btn" onclick="copyChat(\''+msgId+'\')"  >COPY</button>'+
      '</div>'+
    '</div>';
    msgs.scrollTop = msgs.scrollHeight;
  } catch(e) {
    document.getElementById(typingId)?.remove();
    msgs.innerHTML += '<div class="chat-msg assistant"><div class="chat-bubble assistant"><span style="color:#e05c5c;">⚠ '+esc(e.message)+'</span></div></div>';
    msgs.scrollTop = msgs.scrollHeight;
  }
  if (btn) btn.disabled = false;
  if (inp) inp.focus();
}

function copyChat(msgId) {
  const el = document.getElementById(msgId);
  const bubble = el ? el.querySelector('.chat-bubble.assistant') : null;
  if (!bubble) return;
  navigator.clipboard.writeText(bubble.innerText).then(() => {
    const btn = el.querySelector('.chat-copy-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(()=>btn.textContent='COPY',1500); }
  });
}

// ── TradingView Chart Modal ────────────────────────────────────────────────────
let tvCurrentSymbol = '';
let tvCurrentInterval = '1D';

function openChartModal(sym, name) {
  tvCurrentSymbol = sym;
  tvCurrentInterval = '1D';
  document.getElementById('tvChartSymbol').textContent = sym;
  document.getElementById('tvChartName').textContent = name || '';
  document.getElementById('tvChartModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Reset interval buttons
  document.querySelectorAll('.tv-int-btn').forEach(b => b.classList.toggle('active', b.dataset.int === '1D'));
  loadTVChart(sym, '1D');
}

function closeTVModal() {
  document.getElementById('tvChartModal').style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('tvChartContainer').innerHTML = '';
}

function setTVInterval(interval) {
  tvCurrentInterval = interval;
  document.querySelectorAll('.tv-int-btn').forEach(b => b.classList.toggle('active', b.dataset.int === interval));
  loadTVChart(tvCurrentSymbol, interval);
}

function loadTVChart(sym, interval) {
  const container = document.getElementById('tvChartContainer');
  container.innerHTML = '';
  // Map our symbols to TradingView format
  const tvSymMap = {
    'GSPC':'SP:SPX','DJI':'DJ:DJI','IXIC':'NASDAQ:NDX','RUT':'TVC:RUT',
    'FTSE':'TVC:UKX','DAX':'TVC:DAX','FCHI':'TVC:CAC40','IBEX':'TVC:IBEX35',
    'N225':'TVC:NI225','HSI':'TVC:HSI','AS51':'TVC:ASX200','SHCOMP':'SSE:000001',
    'TASI':'TADAWUL:TASI','DFMGI':'DFM:DFMGI',
    'GC=F':'TVC:GOLD','SI=F':'TVC:SILVER','CL=F':'TVC:USOIL','BZ=F':'TVC:UKOIL',
    'BTC-USD':'COINBASE:BTCUSD','ETH-USD':'COINBASE:ETHUSD',
    'EURUSD=X':'FX:EURUSD','GBPUSD=X':'FX:GBPUSD','JPY=X':'FX:USDJPY',
    'AAPL':'NASDAQ:AAPL','MSFT':'NASDAQ:MSFT','GOOGL':'NASDAQ:GOOGL',
    'AMZN':'NASDAQ:AMZN','NVDA':'NASDAQ:NVDA','TSLA':'NASDAQ:TSLA',
  };
  const tvSym = tvSymMap[sym] || sym;
  const script = document.createElement('script');
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  script.async = true;
  script.innerHTML = JSON.stringify({
    autosize: true,
    symbol: tvSym,
    interval: interval,
    timezone: 'Etc/UTC',
    theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
    style: '1',
    locale: 'en',
    hide_top_toolbar: false,
    hide_legend: false,
    allow_symbol_change: true,
    save_image: false,
    calendar: false,
    height: 420,
    width: '100%',
  });
  const wrapper = document.createElement('div');
  wrapper.className = 'tradingview-widget-container';
  wrapper.style.cssText = 'height:420px;width:100%;';
  const innerDiv = document.createElement('div');
  innerDiv.className = 'tradingview-widget-container__widget';
  innerDiv.style.cssText = 'height:420px;width:100%;';
  wrapper.appendChild(innerDiv);
  wrapper.appendChild(script);
  container.appendChild(wrapper);
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  const modal = document.getElementById('tvChartModal');
  if (modal && e.target === modal) closeTVModal();
});

document.addEventListener('DOMContentLoaded', () => {
  const ci = document.getElementById('chatInput');
  if (ci) ci.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();} });
});

function dismissDisclaimer() {
  const el = document.getElementById('disclaimerBanner');
  if (el) { el.style.display = 'none'; LS.set('discDismissed', true); }
}

function toggleLivePopover(e) { e.stopPropagation(); document.getElementById('livePopover').classList.toggle('open'); }
document.addEventListener('click', () => { const p = document.getElementById('livePopover'); if (p) p.classList.remove('open'); });

function setRefreshInterval(mins) {
  refreshIntervalMins = mins; LS.set('refreshMins', mins);
  const lbl = document.getElementById('refreshLabel'); if (lbl) lbl.textContent = 'Live · '+mins+'m';
  [5,10,15,30,60].forEach(m => { const el = document.getElementById('ro'+m); if (el) el.classList.toggle('active', m===mins); });
  document.querySelectorAll('.interval-btn').forEach(b => { b.classList.toggle('active', parseInt(b.textContent)===mins); });
  setupRefreshTimer();
}

let refreshTimer2 = null;
function setupRefreshTimer() {
  if (refreshTimer2) clearInterval(refreshTimer2);
  if (!autoRefreshEnabled) return;
  refreshTimer2 = setInterval(() => {
    if (currentTab==='news') { delete CACHE['news_'+currentRegion]; loadNews(currentRegion); }
    else if (currentTab==='markets') loadMarkets(true);
  }, refreshIntervalMins * 60000);
}

function toggleDarkMode() {
  const on = document.getElementById('darkModeToggle').checked;
  document.documentElement.setAttribute('data-theme', on?'dark':'light');
  LS.set('darkMode', on);
}
function toggleAutoRefresh() {
  autoRefreshEnabled = document.getElementById('autoRefreshToggle').checked;
  LS.set('autoRefresh', autoRefreshEnabled);
  setupRefreshTimer();
}
function toggleCitations() { showCitations = document.getElementById('citationsToggle').checked; LS.set('citations', showCitations); }
function toggleAiBadge() { showAiBadge = document.getElementById('aiBadgeToggle').checked; LS.set('aiBadge', showAiBadge); }
function saveDefaultTopic() { LS.set('defaultTopic', document.getElementById('defaultTopicSel').value); }
function clearCache() { Object.keys(CACHE).forEach(k => delete CACHE[k]); if (currentTab==='news') loadNews(currentRegion); }
function resetAll() {
  if (confirm('Reset all settings and clear cache?')) { localStorage.clear(); location.reload(); }
}

function initSettingsUI() {
  renderSettingsAccount();
  document.getElementById('darkModeToggle').checked = LS.get('darkMode', false);
  document.getElementById('autoRefreshToggle').checked = autoRefreshEnabled;
  document.getElementById('citationsToggle').checked = showCitations;
  document.getElementById('aiBadgeToggle').checked = showAiBadge;
  const defSel = document.getElementById('defaultTopicSel');
  if (defSel) defSel.value = LS.get('defaultTopic', 'Global/World');
  document.querySelectorAll('.interval-btn').forEach(b => { b.classList.toggle('active', parseInt(b.textContent)===refreshIntervalMins); });
}

(function init() {
  // Respect OS dark mode preference on first visit, else use saved preference
  const savedTheme = LS.get('darkMode', null);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = savedTheme !== null ? savedTheme : prefersDark;
  if (useDark) document.documentElement.setAttribute('data-theme', 'dark');
  // Sync the toggle in settings
  const dmToggle = document.getElementById('darkModeToggle');
  if (dmToggle) dmToggle.checked = useDark;
  if (LS.get('discDismissed', false)) { const el = document.getElementById('disclaimerBanner'); if (el) el.style.display = 'none'; }
  showCitations = LS.get('citations', true);
  showAiBadge = LS.get('aiBadge', true);
  autoRefreshEnabled = LS.get('autoRefresh', true);
  refreshIntervalMins = LS.get('refreshMins', 15);
  archiveItems = LS.get('archive', []);
  currentBriefTopic = LS.get('lastBrief', '');
  currentAirspace = LS.get('lastAirspace', '');
  document.getElementById('refreshLabel').textContent = 'Live · '+refreshIntervalMins+'m';
  setRefreshInterval(refreshIntervalMins);
  const lastTab = LS.get('lastTab', 'news');
  currentRegion = LS.get('lastRegion', LS.get('defaultTopic', 'Global/World'));
  document.querySelectorAll('#regionPills .pill').forEach(b => {
    const r = b.getAttribute('onclick')?.match(/'([^']+)'\)$/)?.[1];
    if (r === currentRegion) b.classList.add('active'); else b.classList.remove('active');
  });
  if (currentAirspace) { const el = document.getElementById('airspaceSearchInput'); if (el) el.value = currentAirspace; }
  if (currentBriefTopic) { const el = document.getElementById('briefSearchInput'); if (el) el.value = currentBriefTopic; }
  // Set press dropdown display
  const pressInp = document.getElementById('pressSearchInput');
  if (pressInp) {
    const opt = PRESS_OPTIONS.find(o => o.value === (currentPressRegion||'Global/World'));
    pressInp.value = opt ? opt.label.replace(/^\S+\s/,'') : 'Global / World';
  }
  switchTab(lastTab);
  loadBreakingTicker();
  initAuth();
  // Restore airspace selections from localStorage
  airspaceSelected = LS.get('airspaceSelected', []);
  renderAirspaceTags();
  setupRefreshTimer();
})();



// ── TOAST NOTIFICATIONS ───────────────────────────────────────────────────────
function showToast(msg, type='info') {
  const existing = document.getElementById('briefly-toast');
  if (existing) existing.remove();
  const colors = { info:'#2563eb', success:'#16a34a', error:'#dc2626', warning:'#d97706' };
  const t = document.createElement('div');
  t.id = 'briefly-toast';
  t.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);
    background:${colors[type]||colors.info};color:#fff;padding:10px 20px;border-radius:30px;
    font-size:13px;font-family:var(--cond);font-weight:600;letter-spacing:.04em;
    z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);
    transition:all .3s cubic-bezier(.4,0,.2,1);opacity:0;`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; });
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(10px)'; setTimeout(()=>t.remove(),300); }, 3000);
}


// ── FLOATING CHAT PANEL ───────────────────────────────────────────────────────
let chatPanelHistory = [];
let chatPanelOpen = false;

function toggleChatPanel() {
  const panel = document.getElementById('chatPanel');
  if (!panel) return;
  chatPanelOpen = !chatPanelOpen;
  panel.style.display = chatPanelOpen ? 'flex' : 'none';
  if (chatPanelOpen) {
    const msgs = document.getElementById('chatPanelMessages');
    if (msgs && !msgs.innerHTML.trim()) {
      msgs.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0;">Ask me anything about current events, geopolitics, or a topic from your brief.</div>';
    }
    setTimeout(() => document.getElementById('chatPanelInput')?.focus(), 100);
  }
}

async function sendChatPanel() {
  const inp = document.getElementById('chatPanelInput');
  const msgs = document.getElementById('chatPanelMessages');
  if (!inp || !msgs) return;
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  inp.disabled = true;

  // Clear placeholder
  if (msgs.querySelector('div[style*="text-align:center"]')) msgs.innerHTML = '';

  // User bubble
  msgs.innerHTML += '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;"><div style="background:var(--gold);color:#07090f;padding:9px 14px;border-radius:16px 16px 4px 16px;font-size:13px;max-width:80%;font-family:var(--sans);">'+esc(q)+'</div></div>';

  // Typing indicator
  const typId = 'cp_' + Date.now();
  msgs.innerHTML += '<div id="'+typId+'" style="display:flex;margin-bottom:10px;"><div style="background:var(--card);border:1px solid var(--border);padding:9px 14px;border-radius:16px 16px 16px 4px;font-size:13px;color:var(--muted);">…</div></div>';
  msgs.scrollTop = msgs.scrollHeight;

  chatPanelHistory.push({ role: 'user', content: q });
  if (chatPanelHistory.length > 20) chatPanelHistory = chatPanelHistory.slice(-20);

  try {
    const res = await apiFetch('/api/ask', {
      body: JSON.stringify({ question: q, history: chatPanelHistory.slice(-10) })
    }, null, 0);
    const answer = res.answer || res.response || 'No response';
    chatPanelHistory.push({ role: 'assistant', content: answer });

    const typEl = document.getElementById(typId);
    if (typEl) typEl.outerHTML = '<div style="display:flex;margin-bottom:10px;"><div style="background:var(--bg2);border:1px solid var(--border);padding:9px 14px;border-radius:16px 16px 16px 4px;font-size:13px;max-width:85%;line-height:1.6;font-family:var(--sans);">'+renderMarkdownChat(answer)+'</div></div>';
  } catch(e) {
    const typEl = document.getElementById(typId);
    if (typEl) typEl.outerHTML = '<div style="color:var(--red);font-size:13px;padding:8px 0;">Error: '+esc(e.message)+'</div>';
  }
  inp.disabled = false;
  inp.focus();
  msgs.scrollTop = msgs.scrollHeight;
}


// ── ACCOUNT SECTION IN SETTINGS ──────────────────────────────────────────────
function renderSettingsAccount() {
  const el = document.getElementById('settingsAccountContent');
  if (!el) return;

  if (!currentUser) {
    el.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px 22px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-weight:700;font-size:15px;color:var(--text);margin-bottom:4px;">Not signed in</div>
          <div style="font-size:13px;color:var(--muted);">Sign in to save briefs and sync your preferences across devices.</div>
        </div>
        <button onclick="switchTab('dashboard')" style="padding:9px 22px;background:var(--gold);color:#07090f;border:none;border-radius:30px;font-family:var(--cond);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;">Sign In / Sign Up</button>
      </div>`;
  } else {
    const email = currentUser.email || '';
    const initial = email[0]?.toUpperCase() || 'U';
    const since = new Date(currentUser.created_at || Date.now()).toLocaleDateString('en-US',{month:'long',year:'numeric'});
    el.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px 22px;">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
          <div style="width:44px;height:44px;border-radius:50%;background:var(--gold);color:#07090f;font-weight:800;font-size:18px;font-family:var(--serif);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initial}</div>
          <div>
            <div style="font-weight:700;font-size:15px;color:var(--text);">${esc(email)}</div>
            <div style="font-size:12px;color:var(--muted);">Member since ${since}</div>
          </div>
          <button onclick="signOut()" style="margin-left:auto;padding:7px 16px;background:transparent;border:1px solid var(--border);border-radius:20px;color:var(--muted);font-size:12px;font-family:var(--sans);cursor:pointer;" onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">Sign Out</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <button onclick="switchTab('dashboard')" style="padding:9px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;font-family:var(--sans);color:var(--text);cursor:pointer;">☁ View Saved Briefs</button>
          <button onclick="switchTab('dashboard')" style="padding:9px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;font-family:var(--sans);color:var(--text);cursor:pointer;">📊 Dashboard</button>
        </div>
      </div>`;
  }
}


// ── ACCOUNT MANAGEMENT FUNCTIONS ─────────────────────────────────────────────
async function saveAccountProfile() {
  const sb = getSupabase();
  if (!sb || !currentUser) return;
  const statusEl = document.getElementById('acct-save-status');
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--muted)'; }

  const displayName = document.getElementById('acct-displayname')?.value.trim();
  const newEmail = document.getElementById('acct-email')?.value.trim();
  const newPass = document.getElementById('acct-password')?.value;
  const newPass2 = document.getElementById('acct-password2')?.value;

  try {
    // Update display name in user metadata
    if (displayName) {
      const { error } = await sb.auth.updateUser({ data: { full_name: displayName, display_name: displayName } });
      if (error) throw error;
    }
    // Update email if changed
    if (newEmail && newEmail !== currentUser.email) {
      const { error } = await sb.auth.updateUser({ email: newEmail });
      if (error) throw error;
      if (statusEl) statusEl.textContent = 'Check your new email to confirm the change.';
    }
    // Update password if provided
    if (newPass) {
      if (newPass !== newPass2) throw new Error('Passwords do not match');
      if (newPass.length < 6) throw new Error('Password must be at least 6 characters');
      const { error } = await sb.auth.updateUser({ password: newPass });
      if (error) throw error;
      document.getElementById('acct-password').value = '';
      document.getElementById('acct-password2').value = '';
    }
    if (statusEl) { statusEl.textContent = '✓ Saved successfully'; statusEl.style.color = '#4caf84'; }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    showToast('Profile updated', 'success');
  } catch(e) {
    if (statusEl) { statusEl.textContent = '✗ ' + e.message; statusEl.style.color = '#e05c5c'; }
    showToast(e.message, 'error');
  }
}

function triggerAvatarUpload() {
  showToast('Avatar upload: To add a photo, use Google sign-in with a profile picture', 'info');
}

async function confirmDeleteAccount() {
  if (!confirm('Are you sure you want to permanently delete your account? This cannot be undone.')) return;
  const code = prompt('Type DELETE to confirm:');
  if (code !== 'DELETE') { showToast('Cancelled', 'info'); return; }
  const sb = getSupabase();
  if (!sb) return;
  showToast('Deleting account…', 'warning');
  // Sign out - actual deletion requires server-side admin API
  await sb.auth.signOut();
  showToast('Account deletion requested. Contact support to complete.', 'info');
}

async function deleteSavedBrief(id) {
  const sb = getSupabase();
  if (!sb || !currentUser) return;
  if (!confirm('Delete this brief?')) return;
  const { error } = await sb.from('saved_briefs').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Failed to delete: ' + error.message, 'error'); return; }
  showToast('Brief deleted', 'success');
  renderDashboard();
}


// ── SAVE BRIEF TO CLOUD ───────────────────────────────────────────────────────
async function saveBriefToCloud() {
  const sb = getSupabase();
  if (!sb) { showToast('Supabase not configured', 'error'); return; }
  if (!currentUser) {
    showToast('Sign in to save briefs to your dashboard', 'info');
    setTimeout(() => switchTab('dashboard'), 1200);
    return;
  }
  const stored = window._lastBriefData;
  if (!stored) { showToast('Generate a brief first', 'error'); return; }

  const btn = document.getElementById('saveToDashBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }

  try {
    const { error } = await sb.from('saved_briefs').insert({
      user_id: currentUser.id,
      topic: stored.topic,
      threat_level: stored.analysis?.threat_level,
      confidence: stored.analysis?.confidence,
      analysis: stored.analysis,
      created_at: new Date().toISOString()
    });
    if (error) throw error;
    showToast('✓ Brief saved to dashboard', 'success');
    if (btn) { btn.textContent = '✓ Saved'; btn.style.background = '#4caf84'; btn.style.color = '#fff'; }
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '☁ Save to Dashboard'; }
  }
}

// ── SUPABASE AUTH & DASHBOARD (4.8 + 4.9) ────────────────────────────────────

const SUPABASE_URL = 'https://xtbtyuwvzhauwhkclxdk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QhuzKINcwDv75Rhh1frSpA_apfghUZr';

let _supabase = null;
let currentUser = null;

function getSupabase() {
  if (_supabase) return _supabase;
  if (!window.supabase) { console.warn('Supabase SDK not loaded'); return null; }
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ── AUTH STATE ────────────────────────────────────────────────────────────────
async function initAuth() {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  updateAuthHeader();
  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateAuthHeader();
    if (document.getElementById('tab-dashboard')?.classList.contains('active')) {
      renderDashboardTab();
    }
    renderSettingsAccount();
  });
}

function updateAuthHeader() {
  // Show user indicator in header if logged in
  const indicator = document.getElementById('authHeaderIndicator');
  if (indicator) {
    if (currentUser) {
      const initial = (currentUser.email || 'U')[0].toUpperCase();
      indicator.innerHTML = `<div onclick="switchTab('dashboard')" style="width:30px;height:30px;border-radius:50%;background:var(--gold);color:#0f1623;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;cursor:pointer;" title="${currentUser.email}">${initial}</div>`;
    } else {
      indicator.innerHTML = `<button onclick="switchTab('dashboard')" style="padding:6px 14px;background:transparent;border:1px solid var(--border);border-radius:20px;color:var(--muted);font-size:12px;cursor:pointer;font-family:var(--sans);">Sign In</button>`;
    }
  }
}

// ── DASHBOARD TAB RENDERER ────────────────────────────────────────────────────
function renderDashboardTab() {
  const authEl = document.getElementById('authContainer');
  const dashEl = document.getElementById('dashboardContainer');
  if (!authEl || !dashEl) return;

  if (!currentUser) {
    authEl.style.display = '';
    dashEl.style.display = 'none';
    renderAuthForms();
  } else {
    authEl.style.display = 'none';
    dashEl.style.display = '';
    renderDashboard();
  }
}

// ── AUTH FORMS ────────────────────────────────────────────────────────────────
function renderAuthForms(mode = 'login') {
  const el = document.getElementById('authContainer');
  if (!el) return;

  const isLogin = mode === 'login';
  el.innerHTML = `
    <div class="auth-card">
      <div class="auth-title">${isLogin ? 'Welcome back' : 'Create account'}</div>
      <div class="auth-subtitle">${isLogin ? 'Sign in to access your saved briefs and dashboard' : 'Save briefs, sync your watchlist, access from any device'}</div>

      <div id="authError" class="auth-error"></div>
      <div id="authSuccess" class="auth-success"></div>

      <button class="auth-google-btn" onclick="signInWithGoogle()">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.4 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8 20-20 0-1.3-.1-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.4 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.6 26.8 36 24 36c-5.3 0-9.6-3.4-11.3-8l-6.6 4.9C9.8 39.7 16.4 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.4 4.3-4.5 5.7l6.2 5.2C40.9 35.6 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
        Continue with Google
      </button>

      <div class="auth-divider">or</div>

      <div class="auth-field">
        <label>Email</label>
        <input type="email" id="authEmail" placeholder="you@example.com" onkeydown="if(event.key==='Enter') ${isLogin ? 'signIn()' : 'signUp()'}">
      </div>
      <div class="auth-field">
        <label>Password</label>
        <input type="password" id="authPassword" placeholder="${isLogin ? 'Your password' : 'At least 6 characters'}" onkeydown="if(event.key==='Enter') ${isLogin ? 'signIn()' : 'signUp()'}">
      </div>

      <button class="auth-btn" id="authSubmitBtn" onclick="${isLogin ? 'signIn()' : 'signUp()'}">${isLogin ? 'Sign In' : 'Create Account'}</button>

      ${isLogin ? `<div class="auth-switch">Forgot password? <a onclick="showResetForm()">Reset it</a></div>` : ''}
      <div class="auth-switch">${isLogin ? "Don't have an account?" : 'Already have an account?'} <a onclick="renderAuthForms('${isLogin ? 'signup' : 'login'}')">${isLogin ? 'Sign up' : 'Sign in'}</a></div>
    </div>
  `;
}

function showResetForm() {
  const el = document.getElementById('authContainer');
  el.innerHTML = `
    <div class="auth-card">
      <div class="auth-title">Reset password</div>
      <div class="auth-subtitle">Enter your email and we'll send a reset link</div>
      <div id="authError" class="auth-error"></div>
      <div id="authSuccess" class="auth-success"></div>
      <div class="auth-field">
        <label>Email</label>
        <input type="email" id="authEmail" placeholder="you@example.com">
      </div>
      <button class="auth-btn" onclick="sendReset()">Send Reset Link</button>
      <div class="auth-switch"><a onclick="renderAuthForms('login')">Back to sign in</a></div>
    </div>
  `;
}

function showAuthMsg(type, msg) {
  const err = document.getElementById('authError');
  const suc = document.getElementById('authSuccess');
  if (!err || !suc) return;
  err.style.display = 'none'; suc.style.display = 'none';
  if (type === 'error') { err.textContent = msg; err.style.display = 'block'; }
  else { suc.textContent = msg; suc.style.display = 'block'; }
}

async function signIn() {
  const sb = getSupabase();
  if (!sb) return;
  const email = document.getElementById('authEmail')?.value.trim();
  const password = document.getElementById('authPassword')?.value;
  if (!email || !password) { showAuthMsg('error', 'Please fill in all fields'); return; }
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showAuthMsg('error', error.message); btn.disabled = false; btn.textContent = 'Sign In'; }
  else renderDashboardTab();
}

async function signUp() {
  const sb = getSupabase();
  if (!sb) return;
  const email = document.getElementById('authEmail')?.value.trim();
  const password = document.getElementById('authPassword')?.value;
  if (!email || !password) { showAuthMsg('error', 'Please fill in all fields'); return; }
  if (password.length < 6) { showAuthMsg('error', 'Password must be at least 6 characters'); return; }
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true; btn.textContent = 'Creating account…';
  const { error } = await sb.auth.signUp({ email, password });
  if (error) { showAuthMsg('error', error.message); btn.disabled = false; btn.textContent = 'Create Account'; }
  else showAuthMsg('success', 'Account created! Check your email to confirm, then sign in.');
  btn.disabled = false; btn.textContent = 'Create Account';
}

async function signInWithGoogle() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
}

async function sendReset() {
  const sb = getSupabase();
  if (!sb) return;
  const email = document.getElementById('authEmail')?.value.trim();
  if (!email) { showAuthMsg('error', 'Enter your email'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) showAuthMsg('error', error.message);
  else showAuthMsg('success', 'Reset link sent — check your email');
}

async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
  currentUser = null;
  updateAuthHeader();
  renderDashboardTab();
}

// ── DASHBOARD RENDERER ────────────────────────────────────────────────────────
async function renderDashboard() {
  const el = document.getElementById('dashboardContainer');
  if (!el || !currentUser) return;

  const email = currentUser.email || '';
  const initial = email[0]?.toUpperCase() || 'U';
  const meta = currentUser.user_metadata || {};
  const displayName = meta.full_name || meta.name || meta.display_name || email.split('@')[0] || 'User';
  const avatarUrl = meta.avatar_url || meta.picture || '';
  const since = new Date(currentUser.created_at || Date.now()).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

  // Load cloud briefs
  let savedBriefs = [];
  try { savedBriefs = await loadSavedBriefs(); } catch(e) {}
  const watchlist = LS.get('watchlist', []);

  const threatColors = { CRITICAL:'#e05c5c', HIGH:'#ff9800', MODERATE:'#ffc107', LOW:'#4caf84', UNKNOWN:'#888' };

  const avatarHtml = avatarUrl
    ? `<img src="${esc(avatarUrl)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid var(--gold);" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="width:72px;height:72px;border-radius:50%;background:var(--gold);color:#07090f;font-weight:800;font-size:28px;font-family:var(--serif);display:none;align-items:center;justify-content:center;">${esc(initial)}</div>`
    : `<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--gold),#f0c040);color:#07090f;font-weight:800;font-size:28px;font-family:var(--serif);display:flex;align-items:center;justify-content:center;">${esc(initial)}</div>`;

  el.innerHTML = `
  <div style="max-width:760px;margin:0 auto;">

    <!-- Profile Header -->
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:28px;margin-bottom:20px;display:flex;align-items:flex-start;gap:22px;flex-wrap:wrap;">
      <div style="position:relative;">
        <div style="display:flex;">${avatarHtml}</div>
        <button onclick="triggerAvatarUpload()" title="Change photo" style="position:absolute;bottom:-4px;right:-4px;width:26px;height:26px;border-radius:50%;background:var(--gold);border:2px solid var(--bg);color:#07090f;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;" >✏</button>
      </div>
      <div style="flex:1;min-width:200px;">
        <div style="font-family:var(--serif);font-size:22px;font-weight:700;margin-bottom:4px;">${esc(displayName)}</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px;">${esc(email)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;font-family:var(--cond);color:var(--muted);background:var(--bg2);padding:4px 10px;border-radius:20px;border:1px solid var(--border);">📅 Member since ${esc(since)}</span>
          <span style="font-size:11px;font-family:var(--cond);color:var(--muted);background:var(--bg2);padding:4px 10px;border-radius:20px;border:1px solid var(--border);">☁ ${savedBriefs.length} saved briefs</span>
          <span style="font-size:11px;font-family:var(--cond);color:var(--muted);background:var(--bg2);padding:4px 10px;border-radius:20px;border:1px solid var(--border);">📍 ${watchlist.length} watchlist items</span>
        </div>
      </div>
      <button onclick="signOut()" style="padding:8px 18px;background:transparent;border:1px solid var(--border);border-radius:20px;color:var(--muted);font-size:12px;font-family:var(--sans);cursor:pointer;flex-shrink:0;transition:all .2s;" onmouseover="this.style.borderColor='#e05c5c';this.style.color='#e05c5c'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">Sign Out</button>
    </div>

    <!-- Edit Profile -->
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:20px;">
      <div style="font-family:var(--cond);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin-bottom:16px;">Edit Profile</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div>
          <label style="font-size:11px;font-family:var(--cond);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px;">Display Name</label>
          <input id="acct-displayname" type="text" value="${esc(displayName)}" style="width:100%;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--sans);font-size:13px;box-sizing:border-box;outline:none;" placeholder="Your name" />
        </div>
        <div>
          <label style="font-size:11px;font-family:var(--cond);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px;">Email</label>
          <input id="acct-email" type="email" value="${esc(email)}" style="width:100%;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--sans);font-size:13px;box-sizing:border-box;outline:none;" placeholder="your@email.com" />
        </div>
        <div>
          <label style="font-size:11px;font-family:var(--cond);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px;">New Password</label>
          <input id="acct-password" type="password" style="width:100%;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--sans);font-size:13px;box-sizing:border-box;outline:none;" placeholder="Leave blank to keep current" />
        </div>
        <div>
          <label style="font-size:11px;font-family:var(--cond);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px;">Confirm Password</label>
          <input id="acct-password2" type="password" style="width:100%;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--sans);font-size:13px;box-sizing:border-box;outline:none;" placeholder="Confirm new password" />
        </div>
      </div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center;">
        <button onclick="saveAccountProfile()" style="padding:10px 24px;background:var(--gold);color:#07090f;border:none;border-radius:30px;font-family:var(--cond);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;">Save Changes</button>
        <span id="acct-save-status" style="font-size:12px;color:var(--muted);font-family:var(--sans);"></span>
      </div>
    </div>

    <!-- Saved Briefs -->
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:20px;">
      <div style="font-family:var(--cond);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
        Saved Briefs
        <span style="color:var(--muted);font-size:11px;">${savedBriefs.length} total</span>
      </div>
      ${savedBriefs.length === 0
        ? '<div style="text-align:center;padding:30px 0;color:var(--muted);font-size:14px;">No saved briefs yet.<br><span style="font-size:12px;opacity:.6;">Generate a brief and click ☁ Save to Dashboard</span></div>'
        : savedBriefs.map(b => {
            const tc = threatColors[b.threat_level] || '#888';
            const d = new Date(b.created_at||Date.now()).toLocaleDateString('en-US',{month:'short',day:'numeric'});
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
              <div style="width:10px;height:10px;border-radius:50%;background:${tc};flex-shrink:0;"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(b.topic||'Untitled')}</div>
                <div style="font-size:11px;color:var(--muted);font-family:var(--cond);">${b.threat_level||'?'} · ${b.confidence||0}% confidence · ${d}</div>
              </div>
              <button onclick="deleteSavedBrief('${b.id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:4px;flex-shrink:0;" title="Delete" onmouseover="this.style.color='#e05c5c'" onmouseout="this.style.color='var(--muted)'">🗑</button>
            </div>`;
          }).join('')
      }
    </div>

    <!-- Preferences -->
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:20px;">
      <div style="font-family:var(--cond);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin-bottom:16px;">Preferences</div>
      <div style="display:flex;flex-direction:column;gap:14px;">
        ${[
          ['Email Notifications', 'Get notified about critical threat level changes', 'pref-email-notifs'],
          ['Brief Digest', 'Weekly summary of your saved briefs', 'pref-digest'],
          ['Live Context', 'Include live news in brief generation', 'pref-live-context'],
        ].map(([label, desc, key]) => {
          const val = LS.get(key, key === 'pref-live-context');
          return `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
            <div>
              <div style="font-size:13px;font-weight:600;">${label}</div>
              <div style="font-size:11px;color:var(--muted);">${desc}</div>
            </div>
            <label class="toggle" style="flex-shrink:0;">
              <input type="checkbox" ${val?'checked':''} onchange="LS.set('${key}',this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Danger Zone -->
    <div style="background:var(--card);border:1px solid rgba(224,92,92,.3);border-radius:var(--radius-lg);padding:24px;margin-bottom:20px;">
      <div style="font-family:var(--cond);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#e05c5c;margin-bottom:16px;">Danger Zone</div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-size:13px;font-weight:600;">Delete Account</div>
          <div style="font-size:11px;color:var(--muted);">Permanently delete your account and all data. This cannot be undone.</div>
        </div>
        <button onclick="confirmDeleteAccount()" style="padding:8px 18px;background:transparent;border:1px solid #e05c5c;border-radius:20px;color:#e05c5c;font-size:12px;font-family:var(--sans);cursor:pointer;">Delete Account</button>
      </div>
    </div>

  </div>`;
}


