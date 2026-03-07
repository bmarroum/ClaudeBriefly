const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";

async function callClaude(system, user, maxTokens = 1024) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`API ${r.status}: ${t.slice(0, 200)}`);
  }
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const text = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  if (!text.trim()) throw new Error("Empty response");
  return text;
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("No JSON found");
  return JSON.parse(clean.slice(s, e + 1));
}

const todayStr = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

// ── NEWS ─────────────────────────────────────────────────────────────────
app.post("/api/news", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });
  try {
    const text = await callClaude(
      `You are a news intelligence editor. Today: ${todayStr()}. Be specific and analytical. Return only valid JSON, no markdown.`,
      `Latest news briefing on "${topic}". JSON format:
{"headline":"Breaking: [title]","summary":"1-2 sentence overview","items":[{"title":"headline","body":"2-3 sentences","sources":"Reuters/AP"},{"title":"headline","body":"2-3 sentences","sources":"BBC"},{"title":"headline","body":"2-3 sentences","sources":"FT"},{"title":"headline","body":"2-3 sentences","sources":"Bloomberg"}]}`,
      1200
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("News:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── BRIEFING ─────────────────────────────────────────────────────────────
app.post("/api/briefing", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });
  try {
    const text = await callClaude(
      `You are a senior intelligence analyst. Today: ${todayStr()}. Be specific. Return only valid JSON, no markdown.`,
      `Intelligence briefing on "${topic}". JSON:
{"executive":"3-4 sentences","ngo":"2-3 sentences on humanitarian/NGO impact","geopolitical":"3-4 sentences on key actors and positions","social":"2-3 sentences on public sentiment","strategic":"3-4 sentences on strategic implications","market":"2-3 sentences on market/economic impact","sources":["Reuters","AP","BBC"]}`,
      1400
    );
    res.json({ analysis: parseJSON(text) });
  } catch (e) {
    console.error("Briefing:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PRESS RELEASES ────────────────────────────────────────────────────────
app.post("/api/press-releases", async (req, res) => {
  const { country, date } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });
  const dateStr = date || new Date().toISOString().split("T")[0];
  try {
    const text = await callClaude(
      `You are a government communications monitor. Today: ${todayStr()}. Return only valid JSON, no markdown.`,
      `Official government press releases from ${country} around ${dateStr}. Include 3-4 releases. JSON:
{"country":"${country}","date":"${dateStr}","releases":[{"title":"title","ministry":"ministry","summary":"2-3 sentences","category":"Foreign Policy","source":"source"}]}
Category: Foreign Policy|Economy|Defense|Health|Environment|Social|Infrastructure|Justice`,
      1200
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("Press:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AIRSPACE ──────────────────────────────────────────────────────────────
app.post("/api/airspace", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });
  try {
    const text = await callClaude(
      `You are an aviation safety analyst. Today: ${todayStr()}. Return only valid JSON, no markdown.`,
      `Airspace and NOTAM status for ${country}. JSON:
{"country":"${country}","status":"OPEN","alert_level":"GREEN","summary":"2-3 sentences on current airspace status","notams":[{"id":"N/A","title":"title","detail":"1-2 sentences","effective":"ongoing","authority":"ICAO"}],"restrictions":["restriction"],"airlines_affected":["airline"],"last_updated":"${todayStr()}","source":"ICAO/EASA/FAA"}
status: OPEN|RESTRICTED|CLOSED|CONFLICT_ZONE. alert_level: GREEN|AMBER|RED|BLACK`,
      900
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("Airspace:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ADVISORIES ────────────────────────────────────────────────────────────
app.post("/api/advisories", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });
  try {
    const text = await callClaude(
      `You are a travel safety analyst. Today: ${todayStr()}. Return only valid JSON, no markdown.`,
      `US and UK travel advisories for ${country}. JSON:
{"country":"${country}","us":{"level":"Level 2: Exercise Increased Caution","level_number":2,"summary":"2-3 sentences","key_risks":["risk1","risk2"],"last_updated":"${todayStr()}","url":"https://travel.state.gov"},"uk":{"level":"Advise against all but essential travel","summary":"2-3 sentences","key_risks":["risk1","risk2"],"last_updated":"${todayStr()}","url":"https://gov.uk/foreign-travel-advice"}}
level_number: 1=Normal, 2=Caution, 3=Reconsider, 4=Do Not Travel`,
      900
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("Advisories:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── MARKETS COMMENTARY ────────────────────────────────────────────────────
app.post("/api/markets/commentary", async (req, res) => {
  try {
    const text = await callClaude(
      `You are a markets analyst. Today: ${todayStr()}. Return only valid JSON, no markdown.`,
      `Market intelligence commentary. JSON:
{"headline":"Market Intelligence — ${todayStr()}","summary":"2-3 sentences on global markets","oil_commentary":"1-2 sentences on crude oil","gold_commentary":"1-2 sentences on gold","fx_commentary":"1-2 sentences on USD/major currencies","regional_commentary":"1-2 sentences on Gulf/Middle East markets","key_data":{"wti":"~$70-75","brent":"~$73-78","gold":"~$2,600-2,700","sp500":"~5,700-5,900"},"sources":["Bloomberg","Reuters"]}`,
      900
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("Commentary:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── MARKETS PRICES ────────────────────────────────────────────────────────
app.get("/api/markets/quote", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "Symbols required" });

  // Try Yahoo Finance
  for (const base of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(`${base}/v8/finance/quote?symbols=${encodeURIComponent(symbols)}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Referer": "https://finance.yahoo.com",
        },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const d = await r.json();
      const quotes = (d?.quoteResponse?.result || [])
        .map(q => ({ symbol: q.symbol, name: q.shortName || q.symbol, price: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent }))
        .filter(q => q.price != null);
      if (quotes.length > 0) return res.json({ quotes, source: "yahoo" });
    } catch (e) { console.warn(`Yahoo ${base} failed:`, e.message); }
  }

  // AI fallback — minimal prompt
  try {
    const text = await callClaude(
      `Financial data assistant. Return only valid JSON, no markdown.`,
      `Realistic current approximate prices for: WTI Crude, Brent, Gold, Silver, Natural Gas, S&P 500, Dow, NASDAQ, FTSE 100, DAX, EUR/USD, GBP/USD, USD/JPY, USD/SAR, USD/AED, USD/KWD. JSON:
{"quotes":[{"symbol":"CL=F","name":"WTI Crude Oil","price":72.45,"change":-0.32,"changePercent":-0.44},{"symbol":"BZ=F","name":"Brent Crude","price":75.80,"change":-0.28,"changePercent":-0.37},{"symbol":"GC=F","name":"Gold","price":2665.30,"change":12.50,"changePercent":0.47},{"symbol":"SI=F","name":"Silver","price":29.45,"change":0.15,"changePercent":0.51},{"symbol":"NG=F","name":"Natural Gas","price":3.85,"change":-0.05,"changePercent":-1.28},{"symbol":"HG=F","name":"Copper","price":4.15,"change":0.02,"changePercent":0.48},{"symbol":"^GSPC","name":"S&P 500","price":5732.00,"change":-18.50,"changePercent":-0.32},{"symbol":"^DJI","name":"Dow Jones","price":42880.00,"change":-95.00,"changePercent":-0.22},{"symbol":"^IXIC","name":"NASDAQ","price":18320.00,"change":-42.00,"changePercent":-0.23},{"symbol":"^FTSE","name":"FTSE 100","price":8215.00,"change":22.00,"changePercent":0.27},{"symbol":"^GDAXI","name":"DAX","price":22450.00,"change":85.00,"changePercent":0.38},{"symbol":"^N225","name":"Nikkei 225","price":37800.00,"change":-120.00,"changePercent":-0.32},{"symbol":"EURUSD=X","name":"EUR/USD","price":1.0842,"change":0.0008,"changePercent":0.07},{"symbol":"GBPUSD=X","name":"GBP/USD","price":1.2891,"change":-0.0012,"changePercent":-0.09},{"symbol":"USDJPY=X","name":"USD/JPY","price":148.95,"change":0.45,"changePercent":0.30},{"symbol":"USDSAR=X","name":"USD/SAR","price":3.7502,"change":0.0001,"changePercent":0.00},{"symbol":"USDAED=X","name":"USD/AED","price":3.6725,"change":0.0000,"changePercent":0.00},{"symbol":"USDKWD=X","name":"USD/KWD","price":0.3075,"change":0.0001,"changePercent":0.03}],"source":"ai_estimate"}
Replace example values with realistic current estimates.`,
      1200
    );
    return res.json(parseJSON(text));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── HEALTH ────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString(), model: MODEL }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Briefly backend running on port ${PORT}`));
