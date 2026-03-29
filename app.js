// ═══════════════════════════════════════════════════════════════════
//  Briefly Intelligence v5.0 — app.js
//  Matches index.html exactly: all IDs, function names, structure
// ═══════════════════════════════════════════════════════════════════

const API = 'https://claudebriefly.onrender.com';

// ─── SAFEAIRSPACE RATINGS ────────────────────────────────────────────
const AIRSPACE_RATINGS = {
  'jordan':        { rating: 'Three', label: 'Caution',   color: '#f59e0b', pips: 3 },
  'lebanon':       { rating: 'Four',  label: 'High Risk', color: '#ef4444', pips: 4 },
  'syria':         { rating: 'Five',  label: 'No Fly',    color: '#7f1d1d', pips: 5 },
  'iraq':          { rating: 'Four',  label: 'High Risk', color: '#ef4444', pips: 4 },
  'iran':          { rating: 'Four',  label: 'High Risk', color: '#ef4444', pips: 4 },
  'israel':        { rating: 'Four',  label: 'High Risk', color: '#ef4444', pips: 4 },
  'palestine':     { rating: 'Five',  label: 'No Fly',    color: '#7f1d1d', pips: 5 },
  'west bank':     { rating: 'Five',  label: 'No Fly',    color: '#7f1d1d', pips: 5 },
  'gaza':          { rating: 'Five',  label: 'No Fly',    color: '#7f1d1d', pips: 5 },
  'yemen':         { rating: 'Five',  label: 'No Fly',    color: '#7f1d1d', pips: 5 },
  'saudi arabia':  { rating: 'Two',   label: 'Low Risk',  color: '#10b981', pips: 2 },
  'saudi':         { rating: 'Two',   label: 'Low Risk',  color: '#10b981', pips: 2 },
  'egypt':         { rating: 'Two',   label: 'Low Risk',  color: '#10b981', pips: 2 },
  'libya':         { rating: 'Five',  label: 'No Fly',    color: '#7f1d1d', pips: 5 },
  'sudan':         { rating: 'Five',  label: 'No Fly',    color: '#7f1d1d', pips: 5 },
  'ukraine':       { rating: 'Five',  label: 'No Fly',    color: '#7f1d1d', pips: 5 },
  'turkey':        { rating: 'Two',   label: 'Low Risk',  color: '#10b981', pips: 2 },
  'kuwait':        { rating: 'Two',   label: 'Low Risk',  color: '#10b981', pips: 2 },
  'uae':           { rating: 'One',   label: 'Safe',      color: '#059669', pips: 1 },
  'qatar':         { rating: 'One',   label: 'Safe',      color: '#059669', pips: 1 },
  'all mena':      { rating: 'Varies', label: 'Mixed',    color: '#6b7280', pips: 0 },
};

// ─── STATE ──────────────────────────────────────────────────────────
let currentRegion = 'Middle East & Africa';
let showCitations = true;
let leafletMap = null;

// ─── INIT ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applySavedSettings();
  loadNews(currentRegion);
  loadTicker();
  loadMarkets();
  initLeafletMap();
  loadInitialAirspaceNews();
});

// ─── SETTINGS RESTORE ───────────────────────────────────────────────
function applySavedSettings() {
  try {
    const dark = JSON.parse(localStorage.getItem('briefly_darkMode') || 'false');
    const el = document.getElementById('darkModeToggle');
    if (el) el.checked = dark;

    showCitations = JSON.parse(localStorage.getItem('briefly_citations') !== null
      ? localStorage.getItem('briefly_citations') : 'true');
    const cEl = document.getElementById('citationsToggle');
    if (cEl) cEl.checked = showCitations;
  } catch(e) {}
}

// ─── DISCLAIMER ──────────────────────────────────────────────────────
function dismissDisclaimer() {
  const el = document.getElementById('disclaimerBanner');
  if (el) el.style.display = 'none';
}

// ─── TAB SWITCHING ───────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const content = document.getElementById('tab-' + tab);
  if (content) content.classList.add('active');
  const btn = document.getElementById('nav-' + tab);
  if (btn) btn.classList.add('active');

  // Resize leaflet map when airspace tab is shown (it needs this to render correctly)
  if (tab === 'airspace' && leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 150);
  }
}

// ─── LIVE REFRESH ────────────────────────────────────────────────────
function forceRefresh() {
  const pill = document.getElementById('livePill');
  if (pill) {
    pill.style.opacity = '0.5';
    setTimeout(() => { pill.style.opacity = '1'; }, 600);
  }
  loadNews(currentRegion);
  loadTicker();
  loadMarkets();
}

// ─── TICKER ──────────────────────────────────────────────────────────
async function loadTicker() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;
  try {
    const res = await fetch(`${API}/api/news?region=Middle East`);
    const data = await res.json();
    const items = (data.articles || []).slice(0, 8);
    if (items.length) {
      track.innerHTML = items
        .map(a => `<span style="margin-right:40px">${a.date ? a.date + ' — ' : ''}${a.title}</span>`)
        .join('');
    }
  } catch(e) {
    track.innerHTML = '<span>Live intelligence feed — MENA & Ukraine</span>';
  }
}

// ══════════════════════════════════════════════════════════════════════
//  NEWS TAB
// ══════════════════════════════════════════════════════════════════════
function selectRegion(btn, region) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  currentRegion = region;
  loadNews(region);
}

async function loadNews(region) {
  const el = document.getElementById('newsContent');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div>Loading ${region} news…</div>`;
  try {
    const res = await fetch(`${API}/api/news?region=${encodeURIComponent(region)}`);
    const data = await res.json();
    renderNewsCards(data.articles || [], el);
  } catch(err) {
    el.innerHTML = `<div class="error-card">⚠️ Failed to load news: ${err.message}</div>`;
  }
}

async function doNewsSearch() {
  const q = document.getElementById('newsSearchInput')?.value?.trim();
  const el = document.getElementById('newsContent');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div>Searching…</div>`;
  try {
    const url = `${API}/api/news?region=${encodeURIComponent(currentRegion)}&q=${encodeURIComponent(q || '')}`;
    const res = await fetch(url);
    const data = await res.json();
    renderNewsCards(data.articles || [], el);
  } catch(err) {
    el.innerHTML = `<div class="error-card">⚠️ Search failed: ${err.message}</div>`;
  }
}

function renderNewsCards(articles, container) {
  if (!articles.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">No articles found</div></div>`;
    return;
  }
  container.innerHTML = articles.map(a => {
    const catClass = 'cat-' + (a.category || 'security').toLowerCase();
    return `
      <div class="news-card">
        <div class="news-card-meta">
          <span class="news-source">${escHtml(a.source || 'Source')}</span>
          ${a.date ? `<span class="news-date">${escHtml(a.date)}</span>` : ''}
          ${a.category ? `<span class="news-category-tag ${catClass}">${escHtml(a.category)}</span>` : ''}
        </div>
        <div class="news-title">
          ${a.url ? `<a href="${escHtml(a.url)}" target="_blank" rel="noopener">${escHtml(a.title || '')}</a>` : escHtml(a.title || '')}
        </div>
        ${a.summary ? `<div class="news-summary">${escHtml(a.summary)}</div>` : ''}
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════
//  BRIEF TAB
// ══════════════════════════════════════════════════════════════════════
function quickBrief(topic) {
  const input = document.getElementById('briefSearchInput');
  if (input) input.value = topic;
  generateBrief();
}

async function generateBrief() {
  const topic = document.getElementById('briefSearchInput')?.value?.trim();
  if (!topic) return;

  const titleEl = document.getElementById('briefTitleText');
  if (titleEl) titleEl.textContent = topic;

  const el = document.getElementById('briefContent');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div>Generating intelligence brief on "${topic}"…</div>`;

  // Disable button during load
  const btn = document.getElementById('briefGenerateBtn');
  if (btn) btn.disabled = true;

  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`${API}/api/briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: topic, focus: topic })
    });
    const data = await res.json();
    renderBriefCard(data, el);
  } catch(err) {
    el.innerHTML = `<div class="error-card">⚠️ Failed to generate brief: ${err.message}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderBriefCard(data, container) {
  if (!data || data.error) {
    container.innerHTML = `<div class="error-card">⚠️ ${data?.error || 'Failed to parse response'}</div>`;
    return;
  }

  const risk = (data.overallRisk || 'Medium').toLowerCase();
  const threatClass = 'threat-' + (risk === 'critical' ? 'critical' : risk === 'high' ? 'high' : risk === 'low' ? 'low' : 'medium');

  const developments = (data.recentDevelopments || []).map(d => `
    <div class="brief-item">
      <div class="brief-item-date">${escHtml(d.date || '')}</div>
      <div class="brief-item-content">
        <strong>${escHtml(d.headline || '')}</strong>
        ${d.detail ? `<p>${escHtml(d.detail)}</p>` : ''}
      </div>
    </div>`).join('');

  const ops = (data.operationalConsiderations || []).map(c => `
    <div class="brief-item">
      <div class="brief-item-date">${escHtml(c.category || '')}</div>
      <div class="brief-item-content"><p>${escHtml(c.detail || '')}</p></div>
    </div>`).join('');

  const sources = showCitations && data.sources?.length
    ? `<div class="brief-sources">Sources: ${data.sources.map(s => escHtml(s)).join(', ')}</div>` : '';

  container.innerHTML = `
    <div class="brief-card">
      <div class="brief-card-header">
        <div>
          <div class="brief-card-title">${escHtml(data.country || '')}</div>
          <div class="brief-card-date">${escHtml(data.date || '')}</div>
        </div>
        <span class="threat-badge ${threatClass}">${escHtml(data.overallRisk || 'Medium')} Risk</span>
      </div>
      <div class="brief-card-body">
        ${data.summary ? `<div class="brief-section-title">Executive Summary</div><div class="brief-summary-text">${escHtml(data.summary)}</div>` : ''}
        ${developments ? `<div class="brief-section-title">Recent Developments</div>${developments}` : ''}
        ${ops ? `<div class="brief-section-title">Operational Considerations</div>${ops}` : ''}
        ${sources}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════
//  AIRSPACE TAB  ←  FIXED: calls POST /api/airspace/status
// ══════════════════════════════════════════════════════════════════════

// Leaflet map
function initLeafletMap() {
  if (typeof L === 'undefined') return;
  try {
    leafletMap = L.map('airspaceMap', { zoomControl: true, scrollWheelZoom: false })
      .setView([29, 40], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(leafletMap);
  } catch(e) { console.warn('Leaflet init failed:', e); }
}

// Load default airspace news on tab init
async function loadInitialAirspaceNews() {
  const el = document.getElementById('airspaceContent');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div>Loading airspace news…</div>`;
  try {
    const res = await fetch(`${API}/api/news?region=MENA&q=airspace aviation NOTAM`);
    const data = await res.json();
    renderNewsCards(data.articles || [], el);
    const label = document.getElementById('airspaceSectionLabel');
    if (label) label.textContent = 'Latest Aviation News';
  } catch(err) {
    el.innerHTML = `<div class="error-card">⚠️ ${err.message}</div>`;
  }
}

// Called by chip buttons in HTML: selectAirspaceCountry(this, 'Jordan')
function selectAirspaceCountry(btn, country) {
  // Highlight active chip
  document.querySelectorAll('#airspaceChips .adv-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Populate search input
  const input = document.getElementById('airspaceSearchInput');
  if (input) input.value = country;

  // Update section label
  const label = document.getElementById('airspaceSectionLabel');
  if (label) label.textContent = `Airspace Status — ${country}`;

  // Fetch status
  fetchAirspaceStatus(country);
}

// Called by search button / Enter key
function doAirspaceSearch() {
  const val = document.getElementById('airspaceSearchInput')?.value?.trim();
  if (!val) return;
  fetchAirspaceStatus(val);
}

// Core fetch — POST /api/airspace/status
async function fetchAirspaceStatus(country) {
  const el = document.getElementById('airspaceContent');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div>Loading airspace status for ${escHtml(country)}…</div>`;

  try {
    const res = await fetch(`${API}/api/airspace/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country })
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    renderAirspaceStatusCard(data, el);
  } catch(err) {
    // Fallback: use hardcoded rating if backend fails
    const key = country.toLowerCase();
    const rd = AIRSPACE_RATINGS[key];
    if (rd) {
      renderAirspaceStatusCard({
        country,
        rating: rd.rating,
        label: rd.label,
        color: rd.color,
        pips: rd.pips,
        source: 'SafeAirspace.net',
        updated: new Date().toISOString().split('T')[0],
        summary: `${country} airspace is currently rated ${rd.rating} (${rd.label}) by SafeAirspace.net.`,
        notams: [],
        recommendation: 'Consult your aviation authority before operations.'
      }, el);
    } else {
      el.innerHTML = `<div class="error-card">⚠️ Could not load airspace status: ${err.message}</div>`;
    }
  }
}

function renderAirspaceStatusCard(data, container) {
  const key = (data.country || '').toLowerCase();
  const localRd = AIRSPACE_RATINGS[key] || {};
  const pipCount = data.pips || localRd.pips || ({ One:1, Two:2, Three:3, Four:4, Five:5 }[data.rating] || 0);
  const color = data.color || localRd.color || '#6b7280';

  const pips = Array.from({ length: 5 }, (_, i) =>
    `<span class="rating-pip ${i < pipCount ? 'pip-active' : 'pip-inactive'}"></span>`
  ).join('');

  const notams = (data.notams || []).length
    ? `<div class="airspace-notams-block">
         <h4>Active NOTAMs / Restrictions</h4>
         <ul class="notam-list">${data.notams.map(n => `<li>${escHtml(n)}</li>`).join('')}</ul>
       </div>` : '';

  const rec = data.recommendation
    ? `<div class="airspace-rec-block">
         <span class="airspace-rec-label">⚡ Recommendation</span>
         <p>${escHtml(data.recommendation)}</p>
       </div>` : '';

  container.innerHTML = `
    <div class="airspace-status-card">
      <div class="airspace-card-header" style="border-left: 4px solid ${color}">
        <div>
          <h2>${escHtml(data.country || '')}</h2>
          <span class="airspace-card-source">${escHtml(data.source || 'SafeAirspace.net')}</span>
        </div>
        <div class="airspace-rating-block">
          <span class="airspace-rating-text" style="color:${color}">${escHtml(data.rating || '')} — ${escHtml(data.label || '')}</span>
          <div class="rating-pips">${pips}</div>
        </div>
      </div>
      <div class="airspace-card-body">
        ${data.summary ? `<p class="airspace-summary">${escHtml(data.summary)}</p>` : ''}
        ${notams}
        ${rec}
        ${data.updated ? `<p class="airspace-updated">Updated: ${escHtml(data.updated)}</p>` : ''}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════
//  ADVISORIES TAB
// ══════════════════════════════════════════════════════════════════════
async function toggleAdvisory(btn, country) {
  // Toggle chip active state
  const wasActive = btn.classList.contains('active');
  document.querySelectorAll('#advisoryChips .adv-chip').forEach(c => c.classList.remove('active'));

  if (wasActive) {
    // Deselect — show empty state
    document.getElementById('advisoryContent').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛡️</div>
        <div class="empty-title">Tap a country above</div>
        <div class="empty-sub">Load the latest travel advisory for any MENA country or Ukraine.</div>
      </div>`;
    return;
  }

  btn.classList.add('active');
  const input = document.getElementById('advisorySearchInput');
  if (input) input.value = country;
  fetchAdvisory(country);
}

async function doAdvisorySearch() {
  const val = document.getElementById('advisorySearchInput')?.value?.trim();
  if (val) fetchAdvisory(val);
}

async function fetchAdvisory(country) {
  const el = document.getElementById('advisoryContent');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div>Loading advisory for ${escHtml(country)}…</div>`;

  try {
    const res = await fetch(`${API}/api/advisories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country })
    });
    const json = await res.json();
    const data = json.data || json;
    renderAdvisoryCard(data, el);
  } catch(err) {
    el.innerHTML = `<div class="error-card">⚠️ Failed to load advisory: ${err.message}</div>`;
  }
}

function renderAdvisoryCard(data, container) {
  if (!data || data.error) {
    container.innerHTML = `<div class="error-card">⚠️ ${data?.error || 'No data'}</div>`;
    return;
  }

  const us = data.us || {};
  const uk = data.uk || {};
  const levelColors = { 1: '#10b981', 2: '#f59e0b', 3: '#f97316', 4: '#dc2626' };
  const levelBg     = { 1: '#d1fae5', 2: '#fef3c7', 3: '#ffedd5', 4: '#fee2e2' };
  const color = levelColors[us.level_number] || '#6b7280';
  const bg    = levelBg[us.level_number]    || '#f3f4f6';

  container.innerHTML = `
    <div class="advisory-card">
      <div class="advisory-card-header">
        <span class="advisory-country">${escHtml(data.country || country || '')}</span>
        ${us.level_number ? `<span class="advisory-level-badge" style="background:${bg};color:${color}">Level ${us.level_number}</span>` : ''}
      </div>
      ${data.summary ? `<p class="advisory-summary">${escHtml(data.summary)}</p>` : ''}
      <div class="advisory-sources-grid">
        <div class="advisory-source-block">
          <h4>🇺🇸 US State Dept</h4>
          <span class="advisory-source-level" style="color:${color}">${escHtml(us.level_label || 'Unknown')}</span>
          ${us.updated ? `<span class="advisory-source-date">Updated: ${escHtml(us.updated)}</span>` : ''}
          ${us.url ? `<a class="advisory-link" href="${escHtml(us.url)}" target="_blank" rel="noopener">View Advisory ↗</a>` : ''}
        </div>
        ${uk.level_label ? `
        <div class="advisory-source-block">
          <h4>🇬🇧 UK FCDO</h4>
          <span class="advisory-source-level">${escHtml(uk.level_label)}</span>
          ${uk.url ? `<a class="advisory-link" href="${escHtml(uk.url)}" target="_blank" rel="noopener">View Advisory ↗</a>` : ''}
        </div>` : ''}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════
//  MARKETS TAB
// ══════════════════════════════════════════════════════════════════════
const COMMODITIES = [
  { symbol: 'XAU/USD', name: 'Gold',       icon: '🥇', type: 'metal'  },
  { symbol: 'XAG/USD', name: 'Silver',     icon: '🥈', type: 'metal'  },
  { symbol: 'CL1!',    name: 'WTI Crude',  icon: '🛢️', type: 'energy' },
  { symbol: 'BZ1!',    name: 'Brent',      icon: '🛢️', type: 'energy' },
  { symbol: 'NG1!',    name: 'Nat Gas',    icon: '🔥', type: 'energy' },
  { symbol: 'ZW1!',    name: 'Wheat',      icon: '🌾', type: 'agri'   },
  { symbol: 'ZC1!',    name: 'Corn',       icon: '🌽', type: 'agri'   },
  { symbol: 'HG1!',    name: 'Copper',     icon: '🔶', type: 'metal'  },
];

async function loadMarkets() {
  renderCommoditySkeleton();
  const symbols = COMMODITIES.map(c => c.symbol).join(',');
  try {
    const res = await fetch(`${API}/api/markets/quote?symbols=${encodeURIComponent(symbols)}`);
    const data = await res.json();
    renderCommodities(data.quotes || []);
    loadMarketCommentary();
  } catch(err) {
    console.error('Markets error:', err);
  }
}

function renderCommoditySkeleton() {
  const el = document.getElementById('ticker-commodities');
  if (!el) return;
  el.innerHTML = COMMODITIES.map(c => `
    <div class="commodity-card" style="opacity:0.5">
      <div class="commodity-icon">${c.icon}</div>
      <div class="commodity-name">${c.name}</div>
      <div class="commodity-price">—</div>
      <div class="commodity-change change-flat">—</div>
    </div>`).join('');
}

function renderCommodities(quotes) {
  const el = document.getElementById('ticker-commodities');
  if (!el) return;
  const map = {};
  quotes.forEach(q => { map[q.symbol] = q; });

  el.innerHTML = COMMODITIES.map(c => {
    const q = map[c.symbol] || {};
    const price = q.price
      ? q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
    const pct = q.percent_change || 0;
    const changeClass = pct > 0 ? 'change-up' : pct < 0 ? 'change-down' : 'change-flat';
    const changeStr = q.percent_change !== undefined
      ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
      : '—';

    return `
      <div class="commodity-card">
        <div class="commodity-icon">${c.icon}</div>
        <div class="commodity-name">${c.name}</div>
        <div class="commodity-price">${price}</div>
        <div class="commodity-change ${changeClass}">${changeStr}</div>
        <div class="commodity-currency">${q.currency || 'USD'}</div>
      </div>`;
  }).join('');
}

async function loadMarketCommentary() {
  const el = document.getElementById('marketCommentary');
  if (!el) return;
  try {
    const res = await fetch(`${API}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'Provide a 2-paragraph market commentary on commodity prices relevant to MENA NGO operations today: oil, wheat, gold. Focus on operational implications.'
      })
    });
    const data = await res.json();
    el.innerHTML = (data.response || '').replace(/\n\n/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
  } catch(err) {
    el.innerHTML = '<p style="color:var(--text-muted)">Market commentary unavailable.</p>';
  }
}

// ══════════════════════════════════════════════════════════════════════
//  SETTINGS TAB
// ══════════════════════════════════════════════════════════════════════
function toggleDarkMode() {
  const checked = document.getElementById('darkModeToggle')?.checked;
  document.documentElement.setAttribute('data-theme', checked ? 'dark' : 'light');
  try { localStorage.setItem('briefly_darkMode', JSON.stringify(checked)); } catch(e) {}
}

function toggleCitations() {
  showCitations = document.getElementById('citationsToggle')?.checked ?? true;
  try { localStorage.setItem('briefly_citations', JSON.stringify(showCitations)); } catch(e) {}
}

function clearCache() {
  try {
    const keys = ['briefly_newsCache', 'briefly_briefCache'];
    keys.forEach(k => localStorage.removeItem(k));
    alert('Cache cleared.');
  } catch(e) { alert('Cache cleared.'); }
}

function resetAll() {
  if (!confirm('Reset all settings and clear cache?')) return;
  try {
    localStorage.clear();
    document.getElementById('darkModeToggle').checked = false;
    document.getElementById('citationsToggle').checked = true;
    document.documentElement.setAttribute('data-theme', 'light');
    showCitations = true;
    alert('Reset complete.');
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════════
//  AI CHAT PANEL
// ══════════════════════════════════════════════════════════════════════
function toggleChatPanel() {
  const panel = document.getElementById('chatPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  if (panel.style.display === 'flex') {
    document.getElementById('chatPanelInput')?.focus();
  }
}

async function sendChatPanel() {
  const input = document.getElementById('chatPanelInput');
  const messages = document.getElementById('chatPanelMessages');
  if (!input || !messages) return;

  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  // Add user message
  messages.innerHTML += `<div class="chat-msg-user">${escHtml(text)}</div>`;
  messages.innerHTML += `<div class="chat-msg-ai" id="chatTyping">…</div>`;
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await fetch(`${API}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text })
    });
    const data = await res.json();
    const typing = document.getElementById('chatTyping');
    if (typing) {
      typing.id = '';
      typing.textContent = data.response || 'No response.';
    }
  } catch(err) {
    const typing = document.getElementById('chatTyping');
    if (typing) { typing.id = ''; typing.textContent = 'Error: ' + err.message; }
  }

  messages.scrollTop = messages.scrollHeight;
}

// ─── UTILITY ─────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
