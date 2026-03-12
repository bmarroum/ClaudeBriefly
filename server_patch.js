// ═══════════════════════════════════════════════════════════════════
// SERVER PATCH — Add to server.js BEFORE the app.listen() line
// FIXES: Markets (Twelve Data) + Airspace Status (AI+web search)
// ═══════════════════════════════════════════════════════════════════

// ── Twelve Data commodity symbol mapping ─────────────────────────
const TWELVE_COMMODITY_MAP = {
  'GC=F':  { symbol: 'XAU/USD',   name: 'Gold' },
  'CL=F':  { symbol: 'WTI/USD',   name: 'WTI Crude Oil' },
  'BZ=F':  { symbol: 'BRENT/USD', name: 'Brent Crude Oil' },
  'NG=F':  { symbol: 'XNG/USD',   name: 'Natural Gas' },
  'ZW=F':  { symbol: 'WHEAT',     name: 'Wheat' },
  'ZC=F':  { symbol: 'CORN',      name: 'Corn' },
  'SI=F':  { symbol: 'XAG/USD',   name: 'Silver' },
  'HG=F':  { symbol: 'COPPER',    name: 'Copper' },
};

// ── Twelve Data quote endpoint ────────────────────────────────────
// GET /api/markets/twelve?symbols=GC=F,CL=F,...
app.get('/api/markets/twelve', async (req, res) => {
  const symbolsParam = req.query.symbols || Object.keys(TWELVE_COMMODITY_MAP).join(',');
  const inputSymbols = symbolsParam.split(',').map(s => s.trim());
  const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY;

  if (!TWELVE_KEY) {
    // Fallback: ask Claude to estimate prices if no Twelve Data key
    return res.json(await estimateMarketsWithClaude(inputSymbols));
  }

  try {
    // Build list of Twelve Data symbols
    const tdSymbols = inputSymbols
      .filter(s => TWELVE_COMMODITY_MAP[s])
      .map(s => TWELVE_COMMODITY_MAP[s].symbol)
      .join(',');

    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tdSymbols)}&apikey=${TWELVE_KEY}`;
    const priceRes = await fetch(url);
    if (!priceRes.ok) throw new Error('Twelve Data HTTP ' + priceRes.status);
    const priceData = await priceRes.json();

    // Also fetch EOD for change calculation
    const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(tdSymbols)}&apikey=${TWELVE_KEY}`;
    const quoteRes = await fetch(quoteUrl);
    const quoteData = quoteRes.ok ? await quoteRes.json() : {};

    const quotes = inputSymbols.map(inputSym => {
      const mapping = TWELVE_COMMODITY_MAP[inputSym];
      if (!mapping) return { symbol: inputSym, price: null };
      const tdSym = mapping.symbol;

      // Twelve Data returns either a flat object (single) or nested (multiple)
      const priceEntry = typeof priceData[tdSym] !== 'undefined' ? priceData[tdSym] : priceData;
      const quoteEntry = typeof quoteData[tdSym] !== 'undefined' ? quoteData[tdSym] : quoteData;

      const price = parseFloat(priceEntry?.price || quoteEntry?.close || 0);
      const prevClose = parseFloat(quoteEntry?.previous_close || quoteEntry?.open || price);
      const change = price && prevClose ? +(price - prevClose).toFixed(4) : null;
      const changePct = price && prevClose ? +((price - prevClose) / prevClose * 100).toFixed(4) : null;

      if (!price || isNaN(price)) return { symbol: inputSym, price: null };

      return {
        symbol: inputSym,
        name: mapping.name,
        price,
        change,
        changePercent: changePct,
        currency: 'USD',
        source: 'twelve_data'
      };
    });

    console.log(`[MARKETS] Twelve Data: ${quotes.filter(q=>q.price).length}/${quotes.length} symbols fetched`);
    return res.json({ quotes, source: 'twelve_data', ts: new Date().toISOString() });

  } catch (err) {
    console.error('[MARKETS] Twelve Data error:', err.message);
    // Fallback to AI estimates
    return res.json(await estimateMarketsWithClaude(inputSymbols));
  }
});

// ── AI fallback when Twelve Data unavailable ─────────────────────
async function estimateMarketsWithClaude(inputSymbols) {
  try {
    const today = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
    const commodityList = inputSymbols.map(s => {
      const m = TWELVE_COMMODITY_MAP[s];
      return m ? `${s} (${m.name})` : s;
    }).join(', ');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `You are a financial data assistant. Today is ${today}. 
Search for and return ONLY a JSON array of current commodity prices. 
Return ONLY valid JSON, no markdown, no explanation.
Format: [{"symbol":"GC=F","price":2340.50,"change":5.20,"changePercent":0.22,"name":"Gold"},...]`,
        messages: [{
          role: 'user',
          content: `Search for current prices of these commodities as of today ${today}: ${commodityList}. 
Return ONLY a JSON array with fields: symbol, price (number), change (number), changePercent (number), name.`
        }]
      })
    });

    if (!r.ok) throw new Error('Claude HTTP ' + r.status);
    const d = await r.json();
    const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) {
      return { quotes: parsed, source: 'ai_estimate', ts: new Date().toISOString() };
    }
    throw new Error('Non-array response');
  } catch (e) {
    console.error('[MARKETS] AI estimate failed:', e.message);
    return { quotes: [], source: 'error', ts: new Date().toISOString() };
  }
}

// ── Airspace status endpoint (FIX 3) ─────────────────────────────
// POST /api/airspace/status
// Body: { country: string, useWebSearch: bool }
app.post('/api/airspace/status', async (req, res) => {
  const { country, useWebSearch } = req.body || {};
  if (!country) return res.status(400).json({ error: 'Country required' });

  const today = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });

  try {
    // Use Claude with web search to get real-time airspace status
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `You are an aviation safety analyst specialising in MENA and Ukraine airspace. 
Today is ${today}. 
Use web search to find the CURRENT airspace status for the requested country.
Search for: NOTAMs, flight bans, airspace closures, aviation advisories.
Then return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "status": "CLOSED|RESTRICTED|OPEN|MONITOR|UNKNOWN",
  "summary": "2-3 sentence plain English summary of current airspace situation",
  "notams": ["NOTAM ref 1", "NOTAM ref 2"],
  "last_updated": "date string",
  "sources": ["source 1", "source 2"],
  "items": [
    {"title": "headline", "body": "description", "sources": "source name", "pubDate": "ISO date", "link": "url", "isLive": true}
  ]
}
Status definitions: CLOSED=airspace fully closed/banned; RESTRICTED=partial restrictions/NOTAMs in effect; OPEN=normal operations; MONITOR=watch for developments; UNKNOWN=insufficient data.`,
        messages: [{
          role: 'user',
          content: `What is the current airspace status for ${country}? Search for latest NOTAMs, flight bans, or restrictions as of ${today}. Return JSON only.`
        }]
      })
    });

    if (!r.ok) throw new Error('Claude HTTP ' + r.status);
    const d = await r.json();
    const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Extract JSON from text if it contains other content
      const match = clean.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    if (!parsed) throw new Error('Could not parse airspace status JSON');

    // Ensure items array exists for renderAirspaceNews
    if (!Array.isArray(parsed.items)) parsed.items = [];
    parsed.aiStatus = {
      status: parsed.status || 'UNKNOWN',
      summary: parsed.summary || '',
      notams: parsed.notams || []
    };

    console.log(`[AIRSPACE] ${country}: ${parsed.status}`);
    return res.json(parsed);

  } catch (err) {
    console.error('[AIRSPACE] Status error:', err.message);
    // Fallback to news search
    return res.status(500).json({
      error: err.message,
      items: [],
      aiStatus: { status: 'UNKNOWN', summary: 'Status check failed. Please verify with official sources.', notams: [] }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BRIEFING OVERRIDE — replaces /api/briefing with a version that:
//   1. Uses Claude web_search for 100% current content
//   2. Removes key_actors from the schema entirely
//   3. Forces all timeline events to have real recent dates
// ═══════════════════════════════════════════════════════════════════

// Remove existing /api/briefing route if already registered
try {
  const routes = app._router && app._router.stack || [];
  const idx = routes.findIndex(r => r.route && r.route.path === '/api/briefing');
  if (idx !== -1) routes.splice(idx, 1);
} catch(_) {}

app.post('/api/briefing', async (req, res) => {
  const { topic, force } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'Topic required' });

  if (!force) {
    const cached = getBriefCache(topic);
    if (cached) {
      console.log('[BRIEF] Cache hit: "' + topic + '"');
      return res.json(Object.assign({}, cached, { cached: true }));
    }
  }

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  const jsonSchema = `{
  "threat_level": "CRITICAL|HIGH|ELEVATED|MODERATE|LOW",
  "threat_level_reason": "one sentence with a specific recent event",
  "confidence": 75,
  "executive": "paragraph — must cite specific events from the past 30 days with dates",
  "situation": "paragraph — ONLY current facts from web search, every claim dated e.g. 'As of March 2025'",
  "geopolitical": "paragraph — current diplomatic/political developments, dated",
  "humanitarian": "paragraph — current conditions with recent statistics",
  "strategic": "paragraph — near-term outlook for the next 2-4 weeks",
  "timeline": [
    {"date": "Month DD YYYY", "event": "specific verified recent event"},
    {"date": "Month DD YYYY", "event": "..."}
  ],
  "key_risks": ["current risk 1", "current risk 2", "current risk 3"],
  "watch_points": ["what to monitor 1", "watch point 2"],
  "related_topics": ["related topic 1", "related topic 2"],
  "sources": [{"name": "Source Name", "url": "https://..."}]
}`;

  const systemPrompt = `You are a senior intelligence analyst producing a situation report.
Today is ${todayStr}.

CRITICAL RULES:
1. Use web_search to find content published in the LAST 30 DAYS ONLY.
2. Do NOT use training data. Every fact must come from a search result.
3. Do NOT include key_actors — this field is removed.
4. Every timeline event MUST have a real specific date (Month DD YYYY). No fabricated dates.
5. If recent data is unavailable for a section, say so explicitly rather than using generic content.
6. All prose must reference specific recent events with dates.
7. Return ONLY valid JSON matching the schema below. No markdown, no preamble.

Schema:
${jsonSchema}`;

  try {
    const searchResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: 'Generate a current intelligence brief for: "' + topic + '"\n\nSearch for the very latest news as of ' + todayStr + '. Focus on events from the past 2-4 weeks. Search multiple times to find dated timeline events. Return ONLY the JSON object.'
        }]
      })
    });

    if (!searchResponse.ok) throw new Error('Claude HTTP ' + searchResponse.status);
    const searchData = await searchResponse.json();

    const textBlocks = (searchData.content || []).filter(function(b) { return b.type === 'text'; });
    const rawText = textBlocks.map(function(b) { return b.text; }).join('');
    const clean = rawText.replace(/```json|```/g, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(clean);
    } catch(_) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No valid JSON in response');
      analysis = JSON.parse(match[0]);
    }

    // Enforce: strip key_actors if backend still returns it
    delete analysis.key_actors;

    // Enforce: only keep timeline events with real years
    if (Array.isArray(analysis.timeline)) {
      analysis.timeline = analysis.timeline.filter(function(ev) {
        return ev.date && ev.event && /\d{4}/.test(ev.date) &&
               ev.date !== 'Unknown' && ev.date !== 'TBD';
      });
    }

    const liveHeadlines = [];
    const result = { analysis: analysis, liveHeadlines: liveHeadlines, searchUsed: true, generatedAt: new Date().toISOString() };
    setBriefCache(topic, result);
    console.log('[BRIEF] Generated "' + topic + '" — threat:' + analysis.threat_level + ' timeline:' + (analysis.timeline && analysis.timeline.length || 0) + ' events');
    return res.json(result);

  } catch (err) {
    console.error('[BRIEF] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// END PATCH
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// END PATCH
// ═══════════════════════════════════════════════════════════════════
