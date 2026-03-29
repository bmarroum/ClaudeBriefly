// ═══════════════════════════════════════════════════════════════════
//  ClaudeBriefly — app.js  (Briefly Intelligence v5.0)
//  Frontend vanilla JS — all tabs: Briefing, News, Airspace, Markets, Advisories
// ═══════════════════════════════════════════════════════════════════

const API_BASE = 'https://claudebriefly.onrender.com';

// ─── STATE ──────────────────────────────────────────────────────────
let currentTab = 'briefing';
let darkMode = false;
let marketsInterval = null;

// ─── INIT ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNav();
  initBriefing();
  initNews();
  initAirspace();
  initMarkets();
  initAdvisories();
  startNewsTicker();
});

// ─── THEME ──────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  setTheme(saved);

  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ─── NAV ─────────────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabId}`));
}

// ─── NEWS TICKER ─────────────────────────────────────────────────────
async function startNewsTicker() {
  const ticker = document.getElementById('news-ticker-content');
  if (!ticker) return;

  try {
    const res = await fetch(`${API_BASE}/api/news?region=MENA`);
    const data = await res.json();
    const articles = data.articles || [];
    if (articles.length) {
      ticker.textContent = articles.map(a => `${a.date ? a.date + ' — ' : ''}${a.title}`).join('   ●   ');
    }
  } catch {
    ticker.textContent = 'Loading latest security news...';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  BRIEFING TAB
// ═══════════════════════════════════════════════════════════════════
function initBriefing() {
  const btn = document.getElementById('generate-brief-btn');
  if (btn) btn.addEventListener('click', generateBriefing);

  const countryInput = document.getElementById('brief-country');
  if (countryInput) {
    countryInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') generateBriefing();
    });
  }
}

async function generateBriefing() {
  const country = document.getElementById('brief-country')?.value?.trim();
  const focus   = document.getElementById('brief-focus')?.value?.trim();
  if (!country) return showError('brief-output', 'Please enter a country name.');

  showLoading('brief-output', `Generating briefing for ${country}…`);

  try {
    const res = await fetch(`${API_BASE}/api/briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country, focus })
    });
    const data = await res.json();
    renderBriefing(data);
  } catch (err) {
    showError('brief-output', `Failed to generate briefing: ${err.message}`);
  }
}

function renderBriefing(data) {
  const el = document.getElementById('brief-output');
  if (!el) return;

  if (data.error) return showError('brief-output', data.error);

  const riskClass = {
    Low: 'risk-low', Medium: 'risk-medium', High: 'risk-high', Critical: 'risk-critical'
  }[data.overallRisk] || 'risk-medium';

  const developments = (data.recentDevelopments || []).map(d => `
    <div class="development-item">
      <span class="dev-date">${d.date || ''}</span>
      <div>
        <strong>${d.headline || ''}</strong>
        <p>${d.detail || ''}</p>
      </div>
    </div>
  `).join('');

  const considerations = (data.operationalConsiderations || []).map(c => `
    <div class="consideration-item">
      <span class="consideration-category">${c.category}</span>
      <p>${c.detail}</p>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="brief-card">
      <div class="brief-header">
        <h2>${data.country}</h2>
        <span class="risk-badge ${riskClass}">${data.overallRisk} Risk</span>
      </div>
      <p class="brief-date">As of ${data.date || new Date().toISOString().split('T')[0]}</p>
      <div class="brief-summary">${data.summary || ''}</div>

      ${developments ? `
        <h3 class="section-heading">Recent Developments</h3>
        <div class="developments-list">${developments}</div>
      ` : ''}

      ${considerations ? `
        <h3 class="section-heading">Operational Considerations</h3>
        <div class="considerations-list">${considerations}</div>
      ` : ''}

      ${data.sources?.length ? `
        <p class="sources-line">Sources: ${data.sources.join(', ')}</p>
      ` : ''}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
//  NEWS TAB
// ═══════════════════════════════════════════════════════════════════
function initNews() {
  const btn = document.getElementById('search-news-btn');
  if (btn) btn.addEventListener('click', searchNews);

  const searchInput = document.getElementById('news-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') searchNews();
    });
  }

  // Load default news
  loadDefaultNews();
}

async function loadDefaultNews() {
  showLoading('news-output', 'Loading latest MENA security news…');
  try {
    const res = await fetch(`${API_BASE}/api/news?region=MENA`);
    const data = await res.json();
    renderNews(data.articles || []);
  } catch (err) {
    showError('news-output', `Failed to load news: ${err.message}`);
  }
}

async function searchNews() {
  const q = document.getElementById('news-search')?.value?.trim();
  const region = document.getElementById('news-region')?.value || 'MENA';
  showLoading('news-output', 'Searching…');
  try {
    const res = await fetch(`${API_BASE}/api/news?region=${encodeURIComponent(region)}&q=${encodeURIComponent(q || '')}`);
    const data = await res.json();
    renderNews(data.articles || []);
  } catch (err) {
    showError('news-output', `Search failed: ${err.message}`);
  }
}

function renderNews(articles) {
  const el = document.getElementById('news-output');
  if (!el) return;

  if (!articles.length) {
    el.innerHTML = '<p class="empty-state">No articles found.</p>';
    return;
  }

  el.innerHTML = articles.map(a => `
    <div class="news-card">
      <div class="news-meta">
        <span class="news-source">${a.source || 'Unknown'}</span>
        <span class="news-date">${a.date || ''}</span>
        <span class="news-category cat-${(a.category || '').toLowerCase()}">${a.category || ''}</span>
      </div>
      <h3 class="news-title">${a.url ? `<a href="${a.url}" target="_blank" rel="noopener">${a.title}</a>` : a.title}</h3>
      <p class="news-summary">${a.summary || ''}</p>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════
//  AIRSPACE TAB  ←  FIXED
// ═══════════════════════════════════════════════════════════════════
const AIRSPACE_COUNTRIES = [
  'Jordan', 'Lebanon', 'Syria', 'Iraq', 'Iran', 'Israel',
  'West Bank', 'Gaza', 'Egypt', 'Libya', 'Sudan', 'Yemen',
  'Saudi Arabia', 'UAE', 'Kuwait', 'Bahrain', 'Qatar', 'Oman',
  'Turkey', 'Ukraine', 'Russia', 'Tunisia', 'Algeria', 'Morocco'
];

function initAirspace() {
  renderAirspaceChips();

  const btn = document.getElementById('airspace-search-btn');
  if (btn) btn.addEventListener('click', () => {
    const val = document.getElementById('airspace-search')?.value?.trim();
    if (val) doAirspaceSearch(val);
  });

  const searchInput = document.getElementById('airspace-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const val = searchInput.value.trim();
        if (val) doAirspaceSearch(val);
      }
    });
  }
}

function renderAirspaceChips() {
  const container = document.getElementById('airspace-country-chips');
  if (!container) return;

  container.innerHTML = AIRSPACE_COUNTRIES.map(c => `
    <button class="country-chip" data-country="${c}" onclick="selectAirspaceCountry('${c}')">
      ${c}
    </button>
  `).join('');
}

function selectAirspaceCountry(country) {
  // Highlight selected chip
  document.querySelectorAll('.country-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.country === country);
  });

  // Populate search input
  const input = document.getElementById('airspace-search');
  if (input) input.value = country;

  doAirspaceSearch(country);
}

// ── Core airspace search function — calls POST /api/airspace/status ──
async function doAirspaceSearch(country) {
  showLoading('airspace-output', `Loading airspace status for ${country}…`);

  try {
    const res = await fetch(`${API_BASE}/api/airspace/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country })
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    renderAirspaceStatusCard(data);
  } catch (err) {
    showError('airspace-output', `Failed to load airspace status: ${err.message}`);
  }
}

// ── Render a single clean SafeAirspace.net status card ──
function renderAirspaceStatusCard(data) {
  const el = document.getElementById('airspace-output');
  if (!el) return;

  if (data.error) return showError('airspace-output', data.error);

  const ratingNum = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 }[data.rating] || 0;
  const stars = Array.from({ length: 5 }, (_, i) =>
    `<span class="rating-pip ${i < ratingNum ? 'pip-active' : 'pip-inactive'}"></span>`
  ).join('');

  const notams = (data.notams || []).length
    ? `<ul class="notam-list">${data.notams.map(n => `<li>${n}</li>`).join('')}</ul>`
    : '';

  el.innerHTML = `
    <div class="airspace-card">
      <div class="airspace-card-header" style="border-left: 4px solid ${data.color || '#6b7280'}">
        <div class="airspace-country-title">
          <h2>${data.country}</h2>
          <span class="airspace-source">SafeAirspace.net</span>
        </div>
        <div class="airspace-rating-block">
          <span class="airspace-rating-label" style="color: ${data.color || '#6b7280'}">${data.rating} – ${data.label}</span>
          <div class="rating-pips">${stars}</div>
        </div>
      </div>

      <div class="airspace-card-body">
        <p class="airspace-summary">${data.summary || ''}</p>

        ${notams ? `
          <div class="airspace-notams">
            <h4>Active NOTAMs / Restrictions</h4>
            ${notams}
          </div>
        ` : ''}

        ${data.recommendation ? `
          <div class="airspace-recommendation">
            <span class="rec-label">⚡ Recommendation</span>
            <p>${data.recommendation}</p>
          </div>
        ` : ''}

        <p class="airspace-updated">Updated: ${data.updated || new Date().toISOString().split('T')[0]}</p>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
//  MARKETS TAB
// ═══════════════════════════════════════════════════════════════════
const MARKET_SYMBOLS = [
  { symbol: 'XAU/USD', name: 'Gold',          icon: '🥇', type: 'metal' },
  { symbol: 'XAG/USD', name: 'Silver',         icon: '🥈', type: 'metal' },
  { symbol: 'CL1!',    name: 'WTI Crude',      icon: '🛢️', type: 'energy' },
  { symbol: 'BZ1!',    name: 'Brent Crude',    icon: '🛢️', type: 'energy' },
  { symbol: 'NG1!',    name: 'Natural Gas',    icon: '🔥', type: 'energy' },
  { symbol: 'ZW1!',    name: 'Wheat',          icon: '🌾', type: 'agri' },
  { symbol: 'ZC1!',    name: 'Corn',           icon: '🌽', type: 'agri' },
  { symbol: 'HG1!',    name: 'Copper',         icon: '🔶', type: 'metal' },
];

function initMarkets() {
  renderMarketSkeleton();
  loadMarkets();

  const btn = document.getElementById('refresh-markets-btn');
  if (btn) btn.addEventListener('click', loadMarkets);
}

function renderMarketSkeleton() {
  const el = document.getElementById('markets-grid');
  if (!el) return;
  el.innerHTML = MARKET_SYMBOLS.map(m => `
    <div class="market-card skeleton" id="market-${m.symbol.replace(/[^a-zA-Z0-9]/g, '-')}">
      <div class="market-icon">${m.icon}</div>
      <div class="market-name">${m.name}</div>
      <div class="market-price">—</div>
      <div class="market-change">—</div>
    </div>
  `).join('');
}

async function loadMarkets() {
  const symbols = MARKET_SYMBOLS.map(m => m.symbol).join(',');
  try {
    const res = await fetch(`${API_BASE}/api/markets/quote?symbols=${encodeURIComponent(symbols)}`);
    const data = await res.json();
    renderMarkets(data.quotes || []);
  } catch (err) {
    console.error('Markets load error:', err);
  }
}

function renderMarkets(quotes) {
  const el = document.getElementById('markets-grid');
  if (!el) return;

  const quoteMap = {};
  quotes.forEach(q => { quoteMap[q.symbol] = q; });

  el.innerHTML = MARKET_SYMBOLS.map(m => {
    const q = quoteMap[m.symbol] || {};
    const price = q.price ? q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const change = q.percent_change || 0;
    const changeClass = change >= 0 ? 'change-up' : 'change-down';
    const changeStr = change ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—';

    return `
      <div class="market-card">
        <div class="market-icon">${m.icon}</div>
        <div class="market-name">${m.name}</div>
        <div class="market-price">${price}</div>
        <div class="market-change ${changeClass}">${changeStr}</div>
        <div class="market-currency">${q.currency || 'USD'}</div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
//  ADVISORIES TAB
// ═══════════════════════════════════════════════════════════════════
function initAdvisories() {
  const btn = document.getElementById('load-advisory-btn');
  if (btn) btn.addEventListener('click', loadAdvisory);

  const input = document.getElementById('advisory-country');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') loadAdvisory();
    });
  }
}

async function loadAdvisory() {
  const country = document.getElementById('advisory-country')?.value?.trim();
  if (!country) return showError('advisory-output', 'Please enter a country name.');

  showLoading('advisory-output', `Loading advisory for ${country}…`);

  try {
    const res = await fetch(`${API_BASE}/api/advisories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country })
    });
    const json = await res.json();
    const data = json.data || json;
    renderAdvisory(data);
  } catch (err) {
    showError('advisory-output', `Failed to load advisory: ${err.message}`);
  }
}

function renderAdvisory(data) {
  const el = document.getElementById('advisory-output');
  if (!el) return;

  if (data.error) return showError('advisory-output', data.error);

  const us = data.us || {};
  const uk = data.uk || {};

  const levelColors = { 1: '#10b981', 2: '#f59e0b', 3: '#f97316', 4: '#dc2626' };
  const color = levelColors[us.level_number] || '#6b7280';

  el.innerHTML = `
    <div class="advisory-card">
      <h2>${data.country || ''}</h2>
      ${data.summary ? `<p class="advisory-summary">${data.summary}</p>` : ''}

      <div class="advisory-sources">
        <div class="advisory-source-block">
          <h3>🇺🇸 US State Department</h3>
          <span class="advisory-level" style="color: ${color}">
            Level ${us.level_number || '?'}: ${us.level_label || 'Unknown'}
          </span>
          ${us.updated ? `<p class="advisory-date">Updated: ${us.updated}</p>` : ''}
          ${us.url ? `<a href="${us.url}" target="_blank" rel="noopener" class="advisory-link">View Advisory ↗</a>` : ''}
        </div>

        ${uk.level_label ? `
          <div class="advisory-source-block">
            <h3>🇬🇧 UK FCDO</h3>
            <span class="advisory-level">${uk.level_label}</span>
            ${uk.url ? `<a href="${uk.url}" target="_blank" rel="noopener" class="advisory-link">View Advisory ↗</a>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════
function showLoading(containerId, message = 'Loading…') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

function showError(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="error-state"><span class="error-icon">⚠️</span> ${message}</div>`;
}
