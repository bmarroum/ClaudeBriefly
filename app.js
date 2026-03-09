
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
let marketsLoaded = false;
let leafletMap = null;
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
  else if (tab === 'archive') renderArchive();
  else if (tab === 'airspace' && !leafletMap) initMap();
  else if (tab === 'settings') initSettingsUI();
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
    const liveHeadlines = data.liveHeadlines || [];
    const ts = new Date().toLocaleString('en-US',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'}) + ' UTC';
    const threat = (a.threat_level || 'MODERATE').toUpperCase();
    const conf = a.confidence || 75;
    const threatIcon = THREAT_ICONS[threat] || '🔵';

    let h = '';

    // Actions bar
    h += '<div class="brief-actions-row">';
    h += '<button class="copy-btn" id="copyBriefBtn" onclick="copyBrief()">📋 Copy Brief</button>';
    h += '<button class="btn-outline" onclick="window.print()">🖨 Print</button>';
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
  text += 'Generated: ' + new Date().toUTCString() + '\nSource: Briefly Intelligence v3.7\n\n';
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
document.getElementById('briefSearchInput').addEventListener('keydown', e => { if (e.key==='Enter') generateBrief(); });

function archiveSave(topic, analysis) {
  const item = { id: Date.now(), topic, date: new Date().toISOString(), analysis };
  archiveItems = [item, ...archiveItems.filter(a => a.topic !== topic)].slice(0, 50);
  LS.set('archive', archiveItems);
}

function renderArchive() {
  const el = document.getElementById('archiveList');
  if (!archiveItems.length) {
    el.innerHTML = '<div class="archive-empty"><div class="archive-empty-icon">🗄</div><div style="font-size:14px;">No saved briefings yet. Generate a brief and it will appear here.</div></div>';
    return;
  }
  el.innerHTML = archiveItems.map(item => `
    <div class="archive-item" onclick="loadArchiveItem(${item.id})">
      <div class="archive-topic">${esc(item.topic)}</div>
      <div class="archive-meta">${new Date(item.date).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</div>
      ${item.analysis?.executive ? '<div class="archive-preview">'+esc(item.analysis.executive.slice(0,120))+'…</div>' : ''}
    </div>`).join('');
}

function loadArchiveItem(id) {
  const item = archiveItems.find(a => a.id === id);
  if (!item) return;
  currentBriefTopic = item.topic;
  document.getElementById('briefSearchInput').value = item.topic;
  document.getElementById('briefTitleText').textContent = item.topic;
  const el = document.getElementById('briefContent');
  const a = item.analysis || {};
  const ts = new Date(item.date).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
  let html = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px;">';
  html += '<div><div class="report-title">'+esc(item.topic)+'</div>';
  html += '<div class="report-meta">Intelligence Brief · '+ts+' <span class="ai-badge">🗄 Archive</span></div></div>';
  html += '<button class="copy-btn" id="copyBriefBtn2" onclick="copyBrief()">📋 Copy Brief</button></div>';
  const sections = [
    {key:'executive',icon:'📌',label:'Executive Summary'},
    {key:'geopolitical',icon:'🌐',label:'Geopolitical Analysis'},
    {key:'humanitarian',icon:'🏥',label:'Humanitarian Impact'},
    {key:'economic',icon:'📊',label:'Economic Impact'},
    {key:'social',icon:'👥',label:'Social Dynamics'},
    {key:'strategic',icon:'🎯',label:'Strategic Outlook'},
  ];
  sections.forEach(s => {
    if (a[s.key]) {
      html += '<div class="section-block"><div class="section-heading">'+s.icon+' '+s.label+'</div>';
      html += '<div class="section-body">'+esc(a[s.key])+'</div></div>';
    }
  });
  el.innerHTML = html;
  switchTab('brief');
}

function clearArchive() {
  if (!confirm('Clear all saved briefings?')) return;
  archiveItems = []; LS.set('archive', []); renderArchive();
}

const COUNTRY_COORDS = {
  'United States':[37.09,-95.71],'Ukraine':[48.38,31.17],'Israel':[31.05,34.85],
  'Iran':[32.43,53.69],'Saudi Arabia':[23.89,45.08],'Russia':[61.52,105.32],
  'Lebanon':[33.85,35.86],'China':[35.86,104.20],'Jordan':[30.59,36.24],
  'Pakistan':[30.38,69.35],'Iraq':[33.22,43.68],'Syria':[34.80,38.99],
  'Yemen':[15.55,48.52],'Libya':[26.34,17.23],'United Kingdom':[55.38,-3.44],
  'France':[46.23,2.21],'Germany':[51.17,10.45],'Japan':[36.20,138.25],
};

function initMap() {
  if (leafletMap) return;
  const mapEl = document.getElementById('airspaceMap');
  if (!mapEl) return;
  leafletMap = L.map('airspaceMap',{zoomControl:true,scrollWheelZoom:false}).setView([25,45],4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
    attribution:'© OpenStreetMap contributors, © CARTO',subdomains:'abcd',maxZoom:18
  }).addTo(leafletMap);
}

// ── AIRSPACE MULTI-SELECT (up to 7) ──────────────────────────────────────────
let airspaceSelected = [];

function renderAirspaceTags() {
  const el = document.getElementById('airspaceSelectedTags');
  if (!el) return;
  el.innerHTML = airspaceSelected.map(c =>
    '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;background:var(--text);color:var(--bg);border-radius:20px;font-family:var(--cond);font-size:11px;font-weight:700;">'
    +esc(c)+'<button onclick="removeAirspaceCountry(\''+esc(c)+'\');" style="background:none;border:none;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0 0 0 3px;opacity:.7;">✕</button></span>'
  ).join('');
  // sync chip active states
  document.querySelectorAll('#tab-airspace .chip').forEach(ch => {
    const country = ch.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (country) ch.classList.toggle('active', airspaceSelected.includes(country));
  });
}

function addAirspaceCountry(country) {
  const c = country || document.getElementById('airspaceSearchInput').value.trim();
  if (!c) return;
  if (airspaceSelected.includes(c)) { loadAllAirspace(); return; }
  if (airspaceSelected.length >= 7) { alert('Maximum 7 countries selected. Remove one first.'); return; }
  airspaceSelected.push(c);
  document.getElementById('airspaceSearchInput').value = '';
  renderAirspaceTags();
  loadAllAirspace();
}

function removeAirspaceCountry(c) {
  airspaceSelected = airspaceSelected.filter(x => x !== c);
  renderAirspaceTags();
  loadAllAirspace();
}

function toggleAirspaceChip(btn, country) {
  if (airspaceSelected.includes(country)) {
    removeAirspaceCountry(country);
  } else {
    addAirspaceCountry(country);
  }
}

function clearAirspaceSelections() {
  airspaceSelected = [];
  renderAirspaceTags();
  document.getElementById('airspaceContent').innerHTML = '';
  if (leafletMap) leafletMap.eachLayer(l => { if (l instanceof L.Marker) leafletMap.removeLayer(l); });
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

async function loadAllAdvisories() {
  const el = document.getElementById('advisoryContent');
  if (!advisorySelected.length) { el.innerHTML = ''; return; }
  el.innerHTML = advisorySelected.map(c =>
    '<div id="adv_card_'+c.replace(/\s+/g,'_')+'"><div class="adv-card"><div class="loading-state"><div class="loading-spinner"></div>Loading '+esc(c)+'…</div></div></div>'
  ).join('');
  advisorySelected.forEach(c => loadSingleAdvisory(c));
}

async function loadSingleAdvisory(c) {
  try {
    const data = await apiFetch('/api/advisories', { body: JSON.stringify({ country: c }) }, 'adv_'+c, 15*60000);
    renderAdvisoryCard(c, data);
  } catch(e) {
    const el = document.getElementById('adv_card_'+c.replace(/\s+/g,'_'));
    if (el) el.innerHTML = '<div class="error-state">⚠ '+esc(c)+': '+esc(e.message)+'</div>';
  }
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
  el.innerHTML = g.symbols.split(',').map(s => '<div class="ticker-card"><div class="tc-symbol">'+esc(s.split('.')[0].replace('^',''))+'</div><div class="loading-spinner" style="width:14px;height:14px;margin:8px 0;"></div></div>').join('');
  try {
    const data = await apiFetch('/api/markets/quote?symbols='+encodeURIComponent(g.symbols),
      { method: 'GET' }, 'mkt_'+g.id, CACHE_TTL.markets);
    const quotes = data.quotes || [];
    const isAI = data.source === 'ai_estimate';
    const isLive = data.source === 'twelvedata';
    updateMarketsSummaryBar(quotes);

    // Fetch real sparkline data for each symbol if Twelve Data available
    const sparklineData = {};
    if (isLive) {
      await Promise.all(quotes.map(async q => {
        try {
          const sd = await apiFetch('/api/markets/sparkline?symbol='+encodeURIComponent(q.symbol)+'&interval=1day&outputsize=30',
            { method: 'GET' }, 'spark_'+q.symbol, CACHE_TTL.markets);
          if (sd && sd.prices) sparklineData[q.symbol] = sd.prices;
        } catch(e) { /* use simulated */ }
      }));
    }

    el.innerHTML = quotes.map(q => {
      const name = g.names[q.symbol] || q.name || q.symbol;
      const up = q.change >= 0;
      const pr = q.price != null ? q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
      const pct = q.changePercent != null ? (up?'+':'')+q.changePercent.toFixed(2)+'%' : '—';
      const chg = q.change != null ? (up?'+':'')+q.change.toFixed(2) : '';
      return buildTickerCard(q, name, up, pr, pct, chg, isAI, sparklineData[q.symbol] || null);
    }).join('') || '<div class="error-state">No data available</div>';
    updateWatchlistSection();
  } catch(e) {
    showError(el, 'Markets unavailable — '+e.message, null);
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
      return '<div class="press-card cat-'+esc(cat)+'">'
        +'<div class="press-country"><div class="press-flag-name">'+esc(r.flag||'')+'  '+esc(r.country||'')+'</div><div class="press-category">'+esc(r.category||'')+'</div></div>'
        +'<div class="press-ministry">'+esc(r.ministry||'')+'</div>'
        +'<div class="press-title">'+esc(r.title)+'</div>'
        +'<div class="press-summary">'+esc(r.summary)+'</div>'
        +(showCitations && r.sourceUrl ? '<a class="press-link" href="'+esc(r.sourceUrl)+'" target="_blank" rel="noopener">🔗 '+esc(r.source||'Source')+'</a>' : '')
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
  document.getElementById('darkModeToggle').checked = LS.get('darkMode', false);
  document.getElementById('autoRefreshToggle').checked = autoRefreshEnabled;
  document.getElementById('citationsToggle').checked = showCitations;
  document.getElementById('aiBadgeToggle').checked = showAiBadge;
  const defSel = document.getElementById('defaultTopicSel');
  if (defSel) defSel.value = LS.get('defaultTopic', 'Global/World');
  document.querySelectorAll('.interval-btn').forEach(b => { b.classList.toggle('active', parseInt(b.textContent)===refreshIntervalMins); });
}

(function init() {
  if (LS.get('darkMode', false)) document.documentElement.setAttribute('data-theme', 'dark');
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
  setupRefreshTimer();
})();

