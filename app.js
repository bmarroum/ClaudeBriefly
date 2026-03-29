// ═══════════════════════════════════════════════════════════════════
//  Briefly Intelligence v5.0 — app.js
//  Written against LIVE server response shapes (claudebriefly.onrender.com)
//
//  Working routes:
//    POST /api/briefing   { topic } → { analysis:{threat_level,executive,situation,
//                                        geopolitical,key_risks[],timeline[],key_actors,
//                                        sources[]}, liveHeadlines[] }
//    POST /api/airspace   { country } → { country,status,alert_level,summary,
//                                         notams[{id,title,detail,effective,authority}],
//                                         restrictions,last_updated }
//    POST /api/advisories { country } → { country,
//                                         us:{level,level_number,summary,key_risks[],url},
//                                         uk:{level,summary,url} }
//    GET  /api/markets/quote?symbols= → { quotes:[{symbol,price,changePercent,currency}] }
// ═══════════════════════════════════════════════════════════════════

const API = 'https://claudebriefly.onrender.com';

// ─── STATE ───────────────────────────────────────────────────────────
let currentRegion = 'Middle East & Africa';
let showCitations = true;
let leafletMap    = null;

// ─── INIT ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applySavedSettings();
  loadNews(currentRegion);
  loadTicker();
  initLeafletMap();
});

// ─── SETTINGS RESTORE ────────────────────────────────────────────────
function applySavedSettings() {
  try {
    const dark = JSON.parse(localStorage.getItem('briefly_darkMode') || 'false');
    const el = document.getElementById('darkModeToggle');
    if (el) el.checked = dark;

    const cit = localStorage.getItem('briefly_citations');
    showCitations = cit !== null ? JSON.parse(cit) : true;
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
  if (tab === 'airspace' && leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 150);
  }
}

// ─── LIVE PILL / REFRESH ─────────────────────────────────────────────
function forceRefresh() {
  const pill = document.getElementById('livePill');
  if (pill) { pill.style.opacity = '0.5'; setTimeout(() => pill.style.opacity = '1', 700); }
  loadNews(currentRegion);
  loadTicker();
  loadMarkets();
}

// ═══════════════════════════════════════════════════════════════════════
//  TICKER  — uses /api/briefing with a news-style topic
// ═══════════════════════════════════════════════════════════════════════
async function loadTicker() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;
  try {
    const res = await apiFetch('/api/briefing', 'POST', { topic: 'MENA security latest news headlines' });
    const headlines = res.liveHeadlines || [];
    if (headlines.length) {
      track.innerHTML = headlines
        .map(h => `<span style="margin-right:48px">● ${escHtml(typeof h === 'string' ? h : h.headline || h.title || '')}</span>`)
        .join('');
    } else {
      track.innerHTML = '<span>Live intelligence feed — MENA &amp; Ukraine</span>';
    }
  } catch(e) {
    track.innerHTML = '<span>Live intelligence feed — MENA &amp; Ukraine</span>';
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  NEWS TAB  — uses /api/briefing to synthesise regional news cards
// ═══════════════════════════════════════════════════════════════════════
function selectRegion(btn, region) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  currentRegion = region;
  loadNews(region);
}

async function loadNews(region) {
  const el = document.getElementById('newsContent');
  if (!el) return;
  setLoading(el, `Loading ${region} intelligence…`);
  try {
    const data = await apiFetch('/api/briefing', 'POST', { topic: `${region} security humanitarian latest developments` });
    renderNewsFromBriefing(data, region, el);
  } catch(err) {
    setError(el, `Failed to load news: ${err.message}`);
  }
}

async function doNewsSearch() {
  const q = document.getElementById('newsSearchInput')?.value?.trim();
  if (!q) return;
  const el = document.getElementById('newsContent');
  if (!el) return;
  setLoading(el, `Searching for "${q}"…`);
  try {
    const data = await apiFetch('/api/briefing', 'POST', { topic: q });
    renderNewsFromBriefing(data, q, el);
  } catch(err) {
    setError(el, `Search failed: ${err.message}`);
  }
}

function renderNewsFromBriefing(data, region, container) {
  const a = data.analysis || {};
  const headlines = data.liveHeadlines || [];

  // Build synthetic news cards from briefing data
  const cards = [];

  // Live headlines first
  headlines.forEach(h => {
    if (typeof h === 'string') {
      cards.push({ title: h, source: 'Live Feed', category: 'Security' });
    } else if (h && h.headline) {
      cards.push({ title: h.headline, summary: h.summary, source: h.source || 'Intelligence', date: h.date, category: 'Security', url: h.url });
    }
  });

  // Timeline events
  (a.timeline || []).forEach(t => {
    if (t && (t.event || t.title)) {
      cards.push({ title: t.event || t.title, summary: t.detail || t.description, date: t.date, source: 'Timeline', category: 'Political' });
    }
  });

  // Situation summary as a card
  if (a.situation) {
    cards.push({ title: `${region} — Situation Overview`, summary: a.situation.substring(0, 200), source: 'Analysis', category: 'Security' });
  }
  if (a.humanitarian) {
    cards.push({ title: `${region} — Humanitarian Update`, summary: a.humanitarian.substring(0, 200), source: 'Analysis', category: 'Humanitarian' });
  }
  if (a.economic) {
    cards.push({ title: `${region} — Economic Conditions`, summary: a.economic.substring(0, 200), source: 'Analysis', category: 'Economic' });
  }

  if (!cards.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">No results found</div></div>`;
    return;
  }

  container.innerHTML = cards.map(c => {
    const catClass = 'cat-' + (c.category || 'security').toLowerCase();
    return `
      <div class="news-card">
        <div class="news-card-meta">
          <span class="news-source">${escHtml(c.source || 'Brief')}</span>
          ${c.date ? `<span class="news-date">${escHtml(c.date)}</span>` : ''}
          ${c.category ? `<span class="news-category-tag ${catClass}">${escHtml(c.category)}</span>` : ''}
        </div>
        <div class="news-title">
          ${c.url ? `<a href="${escHtml(c.url)}" target="_blank" rel="noopener">${escHtml(c.title)}</a>` : escHtml(c.title)}
        </div>
        ${c.summary ? `<div class="news-summary">${escHtml(c.summary)}</div>` : ''}
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
//  BRIEF TAB
// ═══════════════════════════════════════════════════════════════════════
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
  setLoading(el, `Generating intelligence brief on "${topic}"…`);

  const btn = document.getElementById('briefGenerateBtn');
  if (btn) btn.disabled = true;

  try {
    const data = await apiFetch('/api/briefing', 'POST', { topic });
    renderBriefCard(data, topic, el);
  } catch(err) {
    setError(el, `Failed to generate brief: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderBriefCard(data, topic, container) {
  const a = data.analysis || {};
  const headlines = data.liveHeadlines || [];

  // Threat level → CSS class
  const tl = (a.threat_level || 'MODERATE').toUpperCase();
  const threatClass = tl === 'CRITICAL' ? 'threat-critical'
    : tl.includes('HIGH') || tl === 'ELEVATED' ? 'threat-high'
    : tl.includes('LOW') || tl === 'MINIMAL' ? 'threat-low'
    : 'threat-medium';

  // Timeline rows
  const timelineRows = (a.timeline || []).slice(0, 6).map(t => `
    <div class="brief-item">
      <div class="brief-item-date">${escHtml(t.date || '')}</div>
      <div class="brief-item-content">
        <strong>${escHtml(t.event || t.title || '')}</strong>
        ${t.detail || t.description ? `<p>${escHtml(t.detail || t.description)}</p>` : ''}
      </div>
    </div>`).join('');

  // Live headlines rows
  const headlineRows = headlines.slice(0, 5).map(h => {
    const title = typeof h === 'string' ? h : (h.headline || h.title || '');
    const summary = typeof h === 'object' ? (h.summary || '') : '';
    const url = typeof h === 'object' ? h.url : null;
    return `
      <div class="brief-item">
        <div class="brief-item-date">${escHtml(typeof h === 'object' && h.date ? h.date : 'Now')}</div>
        <div class="brief-item-content">
          <strong>${url ? `<a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(title)}</a>` : escHtml(title)}</strong>
          ${summary ? `<p>${escHtml(summary)}</p>` : ''}
        </div>
      </div>`;
  }).join('');

  // Key risks pills
  const risks = (a.key_risks || []).map(r =>
    `<span class="brief-risk-pill">${escHtml(r)}</span>`).join('');

  // Sources
  const sources = showCitations && (a.sources || []).length
    ? `<div class="brief-sources">Sources: ${a.sources.map(s => escHtml(s)).join(' · ')}</div>` : '';

  container.innerHTML = `
    <div class="brief-card">
      <div class="brief-card-header">
        <div>
          <div class="brief-card-title">${escHtml(topic)}</div>
          <div class="brief-card-date">
            ${escHtml(a.classification || 'Intelligence Brief')}
            ${data.engine ? ' · ' + escHtml(data.engine) : ''}
          </div>
        </div>
        <span class="threat-badge ${threatClass}">${escHtml(a.threat_level || 'MODERATE')}</span>
      </div>
      <div class="brief-card-body">

        ${a.executive ? `
          <div class="brief-section-title">Executive Summary</div>
          <div class="brief-summary-text">${escHtml(a.executive)}</div>
        ` : ''}

        ${headlineRows ? `
          <div class="brief-section-title">Live Headlines</div>
          ${headlineRows}
        ` : ''}

        ${a.situation ? `
          <div class="brief-section-title">Situation</div>
          <div class="brief-summary-text">${escHtml(a.situation)}</div>
        ` : ''}

        ${a.geopolitical ? `
          <div class="brief-section-title">Geopolitical Context</div>
          <div class="brief-summary-text">${escHtml(a.geopolitical)}</div>
        ` : ''}

        ${a.humanitarian ? `
          <div class="brief-section-title">Humanitarian</div>
          <div class="brief-summary-text">${escHtml(a.humanitarian)}</div>
        ` : ''}

        ${timelineRows ? `
          <div class="brief-section-title">Timeline</div>
          ${timelineRows}
        ` : ''}

        ${risks ? `
          <div class="brief-section-title">Key Risks</div>
          <div class="brief-risks">${risks}</div>
        ` : ''}

        ${a.strategic ? `
          <div class="brief-section-title">Strategic Outlook</div>
          <div class="brief-summary-text">${escHtml(a.strategic)}</div>
        ` : ''}

        ${sources}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  AIRSPACE TAB  — uses POST /api/airspace (the working route)
// ═══════════════════════════════════════════════════════════════════════

// Alert level → colour
const ALERT_COLORS = {
  'GREEN':  '#059669',
  'AMBER':  '#f59e0b',
  'ORANGE': '#f97316',
  'RED':    '#dc2626',
  'BLACK':  '#1f2937',
};

const ALERT_LABELS = {
  'SAFE':       { color: '#059669', pips: 1 },
  'LOW':        { color: '#10b981', pips: 2 },
  'AMBER':      { color: '#f59e0b', pips: 3 },
  'ORANGE':     { color: '#f97316', pips: 4 },
  'RED':        { color: '#dc2626', pips: 5 },
  'RESTRICTED': { color: '#f59e0b', pips: 3 },
  'HIGH RISK':  { color: '#ef4444', pips: 4 },
  'NO FLY':     { color: '#7f1d1d', pips: 5 },
};

function initLeafletMap() {
  if (typeof L === 'undefined') return;
  try {
    leafletMap = L.map('airspaceMap', { zoomControl: true, scrollWheelZoom: false })
      .setView([29, 40], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 18
    }).addTo(leafletMap);
  } catch(e) { console.warn('Leaflet init failed:', e); }
}

function selectAirspaceCountry(btn, country) {
  document.querySelectorAll('#airspaceChips .adv-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const input = document.getElementById('airspaceSearchInput');
  if (input) input.value = country;
  const label = document.getElementById('airspaceSectionLabel');
  if (label) label.textContent = `Airspace Status — ${country}`;
  fetchAirspaceStatus(country);
}

function doAirspaceSearch() {
  const val = document.getElementById('airspaceSearchInput')?.value?.trim();
  if (val) {
    const label = document.getElementById('airspaceSectionLabel');
    if (label) label.textContent = `Airspace Status — ${val}`;
    fetchAirspaceStatus(val);
  }
}

async function fetchAirspaceStatus(country) {
  const el = document.getElementById('airspaceContent');
  if (!el) return;
  setLoading(el, `Loading airspace status for ${country}…`);
  try {
    const data = await apiFetch('/api/airspace', 'POST', { country });
    renderAirspaceCard(data, el);
  } catch(err) {
    setError(el, `Failed to load airspace status: ${err.message}`);
  }
}

function renderAirspaceCard(data, container) {
  const alert = (data.alert_level || 'AMBER').toUpperCase();
  const status = (data.status || 'UNKNOWN').toUpperCase();
  const alertInfo = ALERT_LABELS[alert] || ALERT_LABELS[status] || { color: '#f59e0b', pips: 3 };
  const color = ALERT_COLORS[alert] || alertInfo.color;

  const pips = Array.from({ length: 5 }, (_, i) =>
    `<span class="rating-pip ${i < alertInfo.pips ? 'pip-active' : 'pip-inactive'}"></span>`
  ).join('');

  const notams = (data.notams || []).slice(0, 5).map(n => `
    <div class="brief-item">
      <div class="brief-item-date">${escHtml(n.effective || n.authority || '')}</div>
      <div class="brief-item-content">
        <strong>${escHtml(n.title || n.id || '')}</strong>
        ${n.detail ? `<p>${escHtml(n.detail)}</p>` : ''}
      </div>
    </div>`).join('');

  const restrictions = (data.restrictions || []).map(r =>
    `<li>${escHtml(typeof r === 'string' ? r : r.detail || r.restriction || '')}</li>`
  ).join('');

  container.innerHTML = `
    <div class="airspace-status-card">
      <div class="airspace-card-header" style="border-left:4px solid ${color}">
        <div>
          <h2>${escHtml(data.country || '')}</h2>
          <span class="airspace-card-source">FlightRadar24 · FAA NOTAMs · SafeAirspace</span>
        </div>
        <div class="airspace-rating-block">
          <span class="airspace-rating-text" style="color:${color}">
            ${escHtml(status)} — ${escHtml(alert)}
          </span>
          <div class="rating-pips">${pips}</div>
        </div>
      </div>
      <div class="airspace-card-body">
        ${data.summary ? `<p class="airspace-summary">${escHtml(data.summary)}</p>` : ''}

        ${notams ? `
          <div class="airspace-notams-block">
            <h4>Active NOTAMs</h4>
            ${notams}
          </div>` : ''}

        ${restrictions ? `
          <div class="airspace-notams-block">
            <h4>Restrictions</h4>
            <ul class="notam-list">${restrictions}</ul>
          </div>` : ''}

        ${data.last_updated ? `<p class="airspace-updated">Updated: ${escHtml(data.last_updated)}</p>` : ''}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  ADVISORIES TAB
// ═══════════════════════════════════════════════════════════════════════
async function toggleAdvisory(btn, country) {
  const wasActive = btn.classList.contains('active');
  document.querySelectorAll('#advisoryChips .adv-chip').forEach(c => c.classList.remove('active'));
  if (wasActive) {
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
  setLoading(el, `Loading advisory for ${country}…`);
  try {
    const data = await apiFetch('/api/advisories', 'POST', { country });
    renderAdvisoryCard(data, el);
  } catch(err) {
    setError(el, `Failed to load advisory: ${err.message}`);
  }
}

function renderAdvisoryCard(data, container) {
  const us = data.us || {};
  const uk = data.uk || {};
  const levelColors = { 1: '#10b981', 2: '#f59e0b', 3: '#f97316', 4: '#dc2626' };
  const levelBg     = { 1: '#d1fae5', 2: '#fef3c7', 3: '#ffedd5', 4: '#fee2e2' };
  const n = us.level_number || 0;
  const color = levelColors[n] || '#6b7280';
  const bg    = levelBg[n]    || '#f3f4f6';

  const usRisks = (us.key_risks || []).map(r => `<span class="brief-risk-pill">${escHtml(r)}</span>`).join('');
  const ukRisks = (uk.key_risks || []).map(r => `<span class="brief-risk-pill">${escHtml(r)}</span>`).join('');

  container.innerHTML = `
    <div class="advisory-card">
      <div class="advisory-card-header">
        <span class="advisory-country">${escHtml(data.country || '')}</span>
        ${n ? `<span class="advisory-level-badge" style="background:${bg};color:${color}">Level ${n}</span>` : ''}
      </div>

      ${us.summary ? `<p class="advisory-summary">${escHtml(us.summary)}</p>` : ''}

      <div class="advisory-sources-grid">
        <div class="advisory-source-block">
          <h4>🇺🇸 US State Dept</h4>
          <span class="advisory-source-level" style="color:${color}">${escHtml(us.level || 'Unknown')}</span>
          ${us.last_updated ? `<span class="advisory-source-date">${escHtml(us.last_updated)}</span>` : ''}
          ${usRisks ? `<div style="margin:6px 0">${usRisks}</div>` : ''}
          ${us.embassy_note ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">${escHtml(us.embassy_note)}</p>` : ''}
          ${us.url ? `<a class="advisory-link" href="${escHtml(us.url)}" target="_blank" rel="noopener">View Advisory ↗</a>` : ''}
        </div>
        <div class="advisory-source-block">
          <h4>🇬🇧 UK FCDO</h4>
          <span class="advisory-source-level">${escHtml(uk.level || 'Unknown')}</span>
          ${uk.last_updated ? `<span class="advisory-source-date">${escHtml(uk.last_updated)}</span>` : ''}
          ${ukRisks ? `<div style="margin:6px 0">${ukRisks}</div>` : ''}
          ${uk.embassy_note ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">${escHtml(uk.embassy_note)}</p>` : ''}
          ${uk.url ? `<a class="advisory-link" href="${escHtml(uk.url)}" target="_blank" rel="noopener">View Advisory ↗</a>` : ''}
        </div>
      </div>
    </div>`;
}



// ═══════════════════════════════════════════════════════════════════════
//  SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════════
function toggleDarkMode() {
  const checked = document.getElementById('darkModeToggle')?.checked;
  document.documentElement.setAttribute('data-theme', checked ? 'dark' : 'light');
  try { localStorage.setItem('briefly_darkMode', JSON.stringify(!!checked)); } catch(e) {}
}

function toggleCitations() {
  showCitations = !!(document.getElementById('citationsToggle')?.checked);
  try { localStorage.setItem('briefly_citations', JSON.stringify(showCitations)); } catch(e) {}
}

function clearCache() {
  try {
    ['briefly_newsCache','briefly_briefCache'].forEach(k => localStorage.removeItem(k));
  } catch(e) {}
  alert('Cache cleared.');
}

function resetAll() {
  if (!confirm('Reset all settings and clear cache?')) return;
  try {
    localStorage.clear();
    const dm = document.getElementById('darkModeToggle');
    const ci = document.getElementById('citationsToggle');
    if (dm) dm.checked = false;
    if (ci) ci.checked = true;
    document.documentElement.setAttribute('data-theme', 'light');
    showCitations = true;
  } catch(e) {}
  alert('Reset complete.');
}

// ═══════════════════════════════════════════════════════════════════════
//  CHAT PANEL  — uses /api/briefing as fallback (no /api/query on server)
// ═══════════════════════════════════════════════════════════════════════
function toggleChatPanel() {
  const panel = document.getElementById('chatPanel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) setTimeout(() => document.getElementById('chatPanelInput')?.focus(), 50);
}

async function sendChatPanel() {
  const input    = document.getElementById('chatPanelInput');
  const messages = document.getElementById('chatPanelMessages');
  if (!input || !messages) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  messages.innerHTML += `<div class="chat-msg-user">${escHtml(text)}</div>`;
  const typingId = 'chat-typing-' + Date.now();
  messages.innerHTML += `<div class="chat-msg-ai" id="${typingId}">…</div>`;
  messages.scrollTop = messages.scrollHeight;

  try {
    const data = await apiFetch('/api/briefing', 'POST', { topic: text });
    const a = data.analysis || {};
    const reply = a.executive || a.situation || 'No response available.';
    const el = document.getElementById(typingId);
    if (el) el.textContent = reply;
  } catch(err) {
    const el = document.getElementById(typingId);
    if (el) el.textContent = 'Error: ' + err.message;
  }
  messages.scrollTop = messages.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════

// Central fetch helper
async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const url = path.startsWith('http') ? path : API + path;
  const res = await fetch(url, opts);
  const text = await res.text();
  // If response starts with '<', it's HTML (likely a 404/error page)
  if (text.trimStart().startsWith('<')) {
    throw new Error(`Server returned an error page for ${path}`);
  }
  return JSON.parse(text);
}

function setLoading(el, msg = 'Loading…') {
  el.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div>${escHtml(msg)}</div>`;
}

function setError(el, msg) {
  el.innerHTML = `<div class="error-card">⚠️ ${escHtml(msg)}</div>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
