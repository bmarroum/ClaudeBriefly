const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";

// ── HELPER: Anthropic with web search ─────────────────────────────────────
async function callWithSearch(systemPrompt, userPrompt, maxTokens = 4096) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const text = (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n");

  if (!text.trim()) throw new Error("Empty response from AI");
  return text;
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response");
  return JSON.parse(clean.slice(start, end + 1));
}

// ── BRIEFING ───────────────────────────────────────────────────────────────
app.post("/api/briefing", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  const system = `You are a senior intelligence analyst. Use web_search to find the LATEST news. Only cite credible sources: Reuters, AP, BBC, AFP, .gov sites, UN, WHO, IMF, FT, The Economist. Never fabricate facts.`;

  const user = `Search for the latest news on: "${topic}". Then return ONLY valid JSON (no markdown, no code fences):
{"executive":"3-4 sentence executive summary","ngo":"2-3 sentences on NGO/humanitarian impact","geopolitical":"3-4 sentences on geopolitical stances of key actors","social":"2-3 sentences on public sentiment","strategic":"3-4 sentences on strategic implications","market":"2-3 sentences on market reactions","sources":["Source 1","Source 2","Source 3"]}`;

  try {
    const text = await callWithSearch(system, user, 4096);
    res.json({ analysis: parseJSON(text) });
  } catch (err) {
    console.error("Briefing error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── NEWS ───────────────────────────────────────────────────────────────────
app.post("/api/news", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  const system = `You are a live news aggregator. Use web_search to find TODAY's breaking news. Use only: Reuters, AP, BBC, AFP, FT, Bloomberg, The Economist.`;

  const user = `Search today's latest news on: "${topic}". Return ONLY valid JSON (no markdown):
{"headline":"Section title","summary":"1-2 sentence overview","items":[{"title":"Headline","body":"2-3 sentence summary","sources":"Reuters"},{"title":"Headline","body":"2-3 sentence summary","sources":"AP"},{"title":"Headline","body":"2-3 sentence summary","sources":"BBC"},{"title":"Headline","body":"2-3 sentence summary","sources":"FT"}]}`;

  try {
    const text = await callWithSearch(system, user, 3000);
    res.json(parseJSON(text));
  } catch (err) {
    console.error("News error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PRESS RELEASES ─────────────────────────────────────────────────────────
app.post("/api/press-releases", async (req, res) => {
  const { country, date } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });
  const dateStr = date || new Date().toISOString().split("T")[0];

  const system = `You are a government communications monitor. Use web_search to find official government press releases. Focus on official ministry websites and head of state statements.`;

  const user = `Search for official government press releases from ${country} around ${dateStr}. Return ONLY valid JSON (no markdown):
{"country":"${country}","date":"${dateStr}","releases":[{"title":"title","ministry":"ministry name","summary":"2-3 sentence summary","category":"Foreign Policy","source":"source"}]}
Category must be one of: Foreign Policy, Economy, Defense, Health, Environment, Social, Infrastructure, Justice`;

  try {
    const text = await callWithSearch(system, user, 3000);
    res.json(parseJSON(text));
  } catch (err) {
    console.error("Press error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AIRSPACE ───────────────────────────────────────────────────────────────
app.post("/api/airspace", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });

  const system = `You are an aviation safety analyst. Use web_search to find the LATEST airspace NOTAMs and restrictions for ${country}. Search FAA, EASA, ICAO, and aviation authority websites.`;

  const user = `Search for current NOTAMs, airspace restrictions, and aviation safety status for ${country}. Return ONLY valid JSON (no markdown):
{"country":"${country}","status":"OPEN","alert_level":"GREEN","summary":"2-3 sentence overview","notams":[{"id":"ID or N/A","title":"title","detail":"1-2 sentences","effective":"date or ongoing","authority":"authority"}],"restrictions":["restriction"],"airlines_affected":["airline"],"last_updated":"today","source":"source name"}
alert_level: GREEN, AMBER, RED, or BLACK. status: OPEN, RESTRICTED, CLOSED, or CONFLICT_ZONE`;

  try {
    const text = await callWithSearch(system, user, 3000);
    res.json(parseJSON(text));
  } catch (err) {
    console.error("Airspace error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── TRAVEL ADVISORIES ──────────────────────────────────────────────────────
app.post("/api/advisories", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });

  const system = `You are a travel safety analyst. Use web_search to find the CURRENT official travel advisories from both the US State Department (travel.state.gov) and the UK Foreign Office (gov.uk/foreign-travel-advice).`;

  const user = `Search travel.state.gov AND gov.uk/foreign-travel-advice for the current official travel advisory for ${country}. Return ONLY valid JSON (no markdown):
{"country":"${country}","us":{"level":"Level 2: Exercise Increased Caution","level_number":2,"summary":"2-3 sentences","key_risks":["risk 1","risk 2"],"last_updated":"date","url":"https://travel.state.gov/..."},"uk":{"level":"Advise against all but essential travel","summary":"2-3 sentences","key_risks":["risk 1","risk 2"],"last_updated":"date","url":"https://www.gov.uk/foreign-travel-advice/..."}}
US level_number must be 1, 2, 3, or 4.`;

  try {
    const text = await callWithSearch(system, user, 3000);
    res.json(parseJSON(text));
  } catch (err) {
    console.error("Advisories error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MARKETS COMMENTARY ─────────────────────────────────────────────────────
app.post("/api/markets/commentary", async (req, res) => {
  const system = `You are a senior markets analyst. Use web_search to find TODAY's actual market prices and commentary. Search for real current prices.`;

  const user = `Search for today's actual prices: "WTI crude oil price today", "gold price today", "S&P 500 today", "FTSE 100 today", "Middle East stock markets". Find real current trading values.

Return ONLY valid JSON (no markdown):
{"headline":"Today's Market Intelligence","summary":"2-3 sentences with actual prices","oil_commentary":"1-2 sentences with real WTI and Brent prices","gold_commentary":"1-2 sentences with real gold price","fx_commentary":"1-2 sentences on USD and key currencies","regional_commentary":"1-2 sentences on Gulf and Middle East markets","key_data":{"wti":"$XX.XX","brent":"$XX.XX","gold":"$X,XXX","sp500":"X,XXX"},"sources":["source1","source2"]}`;

  try {
    const text = await callWithSearch(system, user, 3000);
    res.json(parseJSON(text));
  } catch (err) {
    console.error("Commentary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MARKETS LIVE PRICES ────────────────────────────────────────────────────
app.get("/api/markets/quote", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "Symbols required" });

  // Try Yahoo Finance v8
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com",
      },
    });

    if (!r.ok) throw new Error(`Yahoo ${r.status}`);
    const data = await r.json();
    const quotes = (data?.quoteResponse?.result || []).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent,
    }));
    if (quotes.length > 0) return res.json({ quotes, source: "yahoo" });
    throw new Error("No quotes returned");
  } catch (e) {
    console.warn("Yahoo Finance failed:", e.message);
  }

  // Fallback: AI search for prices
  try {
    const system = `You are a financial data assistant. Use web_search to find today's live market prices.`;
    const user = `Search for the current live prices of these instruments today: WTI Crude Oil, Brent Crude, Gold, Silver, Natural Gas, S&P 500, Dow Jones, NASDAQ, FTSE 100, DAX, EUR/USD, GBP/USD, USD/JPY, USD/SAR, USD/AED.

Return ONLY valid JSON (no markdown) — use real prices you find:
{"quotes":[{"symbol":"CL=F","name":"WTI Crude Oil","price":72.45,"change":-0.32,"changePercent":-0.44},{"symbol":"BZ=F","name":"Brent Crude","price":75.80,"change":-0.28,"changePercent":-0.37},{"symbol":"GC=F","name":"Gold","price":2650.30,"change":8.50,"changePercent":0.32},{"symbol":"SI=F","name":"Silver","price":29.45,"change":0.15,"changePercent":0.51},{"symbol":"NG=F","name":"Natural Gas","price":2.85,"change":-0.05,"changePercent":-1.72},{"symbol":"^GSPC","name":"S&P 500","price":5800.00,"change":25.50,"changePercent":0.44},{"symbol":"^DJI","name":"Dow Jones","price":43000.00,"change":120.00,"changePercent":0.28},{"symbol":"^IXIC","name":"NASDAQ","price":18500.00,"change":85.00,"changePercent":0.46},{"symbol":"^FTSE","name":"FTSE 100","price":8200.00,"change":-15.00,"changePercent":-0.18},{"symbol":"^GDAXI","name":"DAX","price":18800.00,"change":45.00,"changePercent":0.24},{"symbol":"EURUSD=X","name":"EUR/USD","price":1.0850,"change":0.0012,"changePercent":0.11},{"symbol":"GBPUSD=X","name":"GBP/USD","price":1.2700,"change":-0.0008,"changePercent":-0.06},{"symbol":"USDJPY=X","name":"USD/JPY","price":149.50,"change":0.30,"changePercent":0.20},{"symbol":"USDSAR=X","name":"USD/SAR","price":3.7500,"change":0.0001,"changePercent":0.00},{"symbol":"USDAED=X","name":"USD/AED","price":3.6725,"change":0.0000,"changePercent":0.00}],"source":"ai_search"}`;

    const text = await callWithSearch(system, user, 3000);
    const data = parseJSON(text);
    return res.json(data);
  } catch (aiErr) {
    console.error("AI market fallback error:", aiErr.message);
    return res.status(500).json({ error: "Markets unavailable: " + aiErr.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Briefly backend running on port ${PORT}`));
