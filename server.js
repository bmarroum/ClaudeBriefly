const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── ENV ────────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const GROQ_KEY      = process.env.GROQ_API_KEY;
const TWELVE_KEY    = process.env.TWELVE_DATA_API_KEY;

// ─── HELPERS ────────────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userPrompt, useWebSearch = false) {
  const tools = useWebSearch ? [{
    type: 'web_search_20250305',
    name: 'web_search'
  }] : undefined;

  const body = {
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  };
  if (tools) body.tools = tools;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  // Extract text blocks only
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return text;
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callGroq(prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`
    },
    body: JSON.stringify({
      model: 'llama3-8b-8192',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024
    })
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

// ─── SAFEAIRSPACE RATINGS ────────────────────────────────────────────────────
// Hardcoded SafeAirspace.net ratings for MENA + Ukraine
// Ratings: One=Safe, Two=Low Risk, Three=Caution, Four=High Risk, Five=No Fly
const AIRSPACE_RATINGS = {
  jordan:        { rating: 'Three',  label: 'Caution',   color: '#f59e0b' },
  lebanon:       { rating: 'Four',   label: 'High Risk', color: '#ef4444' },
  syria:         { rating: 'Five',   label: 'No Fly',    color: '#7f1d1d' },
  iraq:          { rating: 'Four',   label: 'High Risk', color: '#ef4444' },
  iran:          { rating: 'Four',   label: 'High Risk', color: '#ef4444' },
  israel:        { rating: 'Four',   label: 'High Risk', color: '#ef4444' },
  'west bank':   { rating: 'Five',   label: 'No Fly',    color: '#7f1d1d' },
  gaza:          { rating: 'Five',   label: 'No Fly',    color: '#7f1d1d' },
  egypt:         { rating: 'Two',    label: 'Low Risk',  color: '#10b981' },
  libya:         { rating: 'Five',   label: 'No Fly',    color: '#7f1d1d' },
  sudan:         { rating: 'Five',   label: 'No Fly',    color: '#7f1d1d' },
  yemen:         { rating: 'Five',   label: 'No Fly',    color: '#7f1d1d' },
  'saudi arabia':{ rating: 'Two',    label: 'Low Risk',  color: '#10b981' },
  uae:           { rating: 'One',    label: 'Safe',      color: '#059669' },
  kuwait:        { rating: 'Two',    label: 'Low Risk',  color: '#10b981' },
  bahrain:       { rating: 'Two',    label: 'Low Risk',  color: '#10b981' },
  qatar:         { rating: 'One',    label: 'Safe',      color: '#059669' },
  oman:          { rating: 'One',    label: 'Safe',      color: '#059669' },
  turkey:        { rating: 'Two',    label: 'Low Risk',  color: '#10b981' },
  ukraine:       { rating: 'Five',   label: 'No Fly',    color: '#7f1d1d' },
  russia:        { rating: 'Four',   label: 'High Risk', color: '#ef4444' },
  tunisia:       { rating: 'Two',    label: 'Low Risk',  color: '#10b981' },
  algeria:       { rating: 'Two',    label: 'Low Risk',  color: '#10b981' },
  morocco:       { rating: 'One',    label: 'Safe',      color: '#059669' },
};

// ─── BRIEFING ────────────────────────────────────────────────────────────────
app.post('/api/briefing', async (req, res) => {
  try {
    const { country, focus } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const systemPrompt = `You are a senior intelligence analyst specializing in NGO safety and security for MENA and Ukraine.
Today's date is ${today}. You MUST only cite events with real, specific dates. Do NOT fabricate dates or events.
Use web search to find current, verified information. Every factual claim must be from a real, dated source.
Respond in JSON only. No markdown, no preamble.`;

    const userPrompt = `Generate a security briefing for NGO operations in ${country}${focus ? ` with focus on: ${focus}` : ''}.

Search the web for the latest security developments in ${country} as of ${today}.

Return JSON with this exact structure:
{
  "country": "${country}",
  "date": "${today}",
  "overallRisk": "Low|Medium|High|Critical",
  "summary": "2-3 sentence executive summary",
  "recentDevelopments": [
    { "date": "YYYY-MM-DD", "headline": "...", "detail": "..." }
  ],
  "operationalConsiderations": [
    { "category": "Movement", "detail": "..." },
    { "category": "Communications", "detail": "..." },
    { "category": "Medical", "detail": "..." }
  ],
  "sources": ["source1", "source2"]
}

Sort recentDevelopments newest first. Only include events with real, verifiable dates.`;

    const text = await callClaude(systemPrompt, userPrompt, true);

    // Strip any JSON fences
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      parsed = { raw: text, error: 'Parse failed' };
    }
    res.json(parsed);
  } catch (err) {
    console.error('Briefing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ADVISORIES ──────────────────────────────────────────────────────────────
app.post('/api/advisories', async (req, res) => {
  try {
    const { country } = req.body;

    const prompt = `You are a travel safety analyst. Look up the current US State Department travel advisory level for ${country}.
Return JSON only:
{
  "country": "${country}",
  "us": {
    "level_number": 1,
    "level_label": "Exercise Normal Precautions",
    "updated": "YYYY-MM-DD",
    "url": "https://travel.state.gov/..."
  },
  "uk": {
    "level_label": "...",
    "url": "https://www.gov.uk/..."
  },
  "summary": "Brief safety overview"
}
Level numbers: 1=Normal, 2=Increased Caution, 3=Reconsider Travel, 4=Do Not Travel.`;

    const text = await callClaude('Return JSON only, no markdown.', prompt, true);
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      parsed = { error: 'Parse failed', raw: text };
    }
    res.json({ data: parsed });
  } catch (err) {
    console.error('Advisories error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── NEWS ─────────────────────────────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  try {
    const { region = 'MENA', q = '' } = req.query;

    const prompt = `You are a news analyst. Search for the latest security and humanitarian news from ${region}${q ? ` related to: ${q}` : ''}.

Return JSON array of 8 recent news items:
[
  {
    "title": "...",
    "summary": "...",
    "source": "Reuters|AP|BBC|...",
    "date": "YYYY-MM-DD",
    "category": "Security|Humanitarian|Political|Economic",
    "url": "https://..."
  }
]
Sort by date, newest first. Only real, verifiable news.`;

    const text = await callClaude('Return JSON array only, no markdown.', prompt, true);
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      parsed = [];
    }
    res.json({ articles: Array.isArray(parsed) ? parsed : [] });
  } catch (err) {
    console.error('News error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── AIRSPACE ─────────────────────────────────────────────────────────────────
// Primary route used by the frontend (POST /api/airspace/status)
app.post('/api/airspace/status', async (req, res) => {
  try {
    const { country } = req.body;
    if (!country) return res.status(400).json({ error: 'country required' });

    const key = country.toLowerCase().trim();
    const ratingData = AIRSPACE_RATINGS[key] || { rating: 'Unknown', label: 'Unknown', color: '#6b7280' };
    const today = new Date().toISOString().split('T')[0];

    // Generate AI summary specific to this country's airspace situation
    const systemPrompt = `You are an aviation safety analyst specializing in MENA and Eastern Europe airspace.
Today is ${today}. Be concise and factual. Return JSON only.`;

    const userPrompt = `Search for the current airspace safety situation for ${country}.
SafeAirspace.net rates ${country} as "${ratingData.rating} – ${ratingData.label}".

Return JSON:
{
  "country": "${country}",
  "rating": "${ratingData.rating}",
  "label": "${ratingData.label}",
  "color": "${ratingData.color}",
  "source": "SafeAirspace.net",
  "updated": "${today}",
  "summary": "2-3 sentences on why this rating applies to ${country} airspace today.",
  "notams": ["Key NOTAM or restriction 1", "Key NOTAM or restriction 2"],
  "recommendation": "Brief operational recommendation for NGO aviation."
}`;

    const text = await callClaude(systemPrompt, userPrompt, true);
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Fallback if AI parse fails
      parsed = {
        country,
        rating: ratingData.rating,
        label: ratingData.label,
        color: ratingData.color,
        source: 'SafeAirspace.net',
        updated: today,
        summary: `${country} airspace is currently rated ${ratingData.rating} (${ratingData.label}) by SafeAirspace.net.`,
        notams: [],
        recommendation: 'Consult your aviation authority before any flights.'
      };
    }
    res.json(parsed);
  } catch (err) {
    console.error('Airspace status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Legacy route kept for backward compatibility
app.post('/api/airspace', async (req, res) => {
  req.url = '/api/airspace/status';
  app.handle(req, res);
});

app.get('/api/airspace', async (req, res) => {
  try {
    const { country } = req.query;
    if (!country) return res.status(400).json({ error: 'country required' });

    const key = country.toLowerCase().trim();
    const ratingData = AIRSPACE_RATINGS[key] || { rating: 'Unknown', label: 'Unknown', color: '#6b7280' };
    const today = new Date().toISOString().split('T')[0];

    res.json({
      country,
      rating: ratingData.rating,
      label: ratingData.label,
      color: ratingData.color,
      source: 'SafeAirspace.net',
      updated: today,
      summary: `${country} airspace is currently rated ${ratingData.rating} (${ratingData.label}) by SafeAirspace.net.`,
      notams: [],
      recommendation: 'Consult your aviation authority before any flights.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MARKETS ─────────────────────────────────────────────────────────────────
app.get('/api/markets/quote', async (req, res) => {
  try {
    const { symbols = '' } = req.query;
    const symbolList = symbols.split(',').map(s => s.trim()).filter(Boolean);

    if (!symbolList.length) return res.json({ quotes: [] });

    const results = await Promise.all(symbolList.map(async (symbol) => {
      try {
        // Metals use /quote endpoint with XAU/USD, XAG/USD format
        const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVE_KEY}`;
        const r = await fetch(url);
        const d = await r.json();
        return {
          symbol,
          name: d.name || symbol,
          price: parseFloat(d.close || d.price || 0),
          change: parseFloat(d.change || 0),
          percent_change: parseFloat(d.percent_change || 0),
          currency: d.currency || 'USD'
        };
      } catch {
        return { symbol, error: true };
      }
    }));

    res.json({ quotes: results });
  } catch (err) {
    console.error('Markets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── SEARCH / QUERY ───────────────────────────────────────────────────────────
app.post('/api/query', async (req, res) => {
  try {
    const { query, context = '' } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const systemPrompt = `You are an intelligence analyst assistant for NGO security operations in MENA and Ukraine.
Today is ${today}. Be concise and factual. Use web search for current information.`;

    const text = await callClaude(systemPrompt, `${context ? context + '\n\n' : ''}${query}`, true);
    res.json({ response: text });
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`ClaudeBriefly server running on port ${process.env.PORT || 3000}`);
});
