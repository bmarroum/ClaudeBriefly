const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";

// ── HELPER: Plain Claude call (no web search tool) ─────────────────────────
async function callClaude(systemPrompt, userPrompt, maxTokens = 4096) {
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

// ── HELPER: web search via Anthropic (if available, else fallback) ──────────
async function callWithSearchOrFallback(systemPrompt, userPrompt, maxTokens = 4096) {
  // Try with web search tool first
  try {
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

    if (!response.ok) throw new Error(`Status ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    if (text.trim()) return text;
    throw new Error("Empty response");
  } catch (err) {
    console.warn("Web search failed, using Claude knowledge fallback:", err.message);
    // Fallback: plain Claude without web search
    return callClaude(systemPrompt, userPrompt, maxTokens);
  }
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  return JSON.parse(clean.slice(start, end + 1));
}

const today = () => new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

// ── BRIEFING ───────────────────────────────────────────────────────────────
app.post("/api/briefing", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  const system = `You are a senior intelligence analyst at a world-class geopolitical risk firm. Today is ${today()}. Provide expert analysis based on your most recent knowledge. Be specific, analytical, and credible. Reference real events, organizations, and actors.`;

  const user = `Provide a detailed intelligence briefing on: "${topic}"

Return ONLY a valid JSON object (no markdown, no code fences, no extra text before or after):
{
  "executive": "3-4 sentence executive summary with specific recent context",
  "ngo": "2-3 sentences on NGO/NPO involvement, humanitarian impact, or civil society response",
  "geopolitical": "3-4 sentences on geopolitical stances and national positions of key actors",
  "social": "2-3 sentences on public sentiment, protests, social media narrative, and information environment",
  "strategic": "3-4 sentences on strategic implications for regional and global power dynamics",
  "market": "2-3 sentences on market reactions, commodity impacts, and economic signals",
  "sources": ["Specific credible source 1", "Specific credible source 2", "Specific credible source 3"]
}`;

  try {
    const text = await callWithSearchOrFallback(system, user, 4096);
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

  const system = `You are a senior news editor at a world-class intelligence wire service. Today is ${today()}. Generate realistic, expert-level news intelligence based on your knowledge of current global affairs. Be specific with real actors, countries, and credible context.`;

  const user = `Generate the latest intelligence news briefing on: "${topic}"

Return ONLY a valid JSON object (no markdown, no code fences):
{
  "headline": "Breaking: [compelling section title]",
  "summary": "1-2 sentence overview of the current landscape for this topic",
  "items": [
    {"title": "Specific news headline 1", "body": "2-3 sentence detailed summary with real context and actors", "sources": "Reuters / AP"},
    {"title": "Specific news headline 2", "body": "2-3 sentence detailed summary with real context", "sources": "BBC / FT"},
    {"title": "Specific news headline 3", "body": "2-3 sentence detailed summary with specific detail", "sources": "Bloomberg / WSJ"},
    {"title": "Specific news headline 4", "body": "2-3 sentence detailed summary with forward-looking context", "sources": "AP / Foreign Affairs"}
  ]
}`;

  try {
    const text = await callWithSearchOrFallback(system, user, 3000);
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

  const system = `You are a government communications monitor. Today is ${today()}. Generate realistic official government press release summaries for ${country} based on your knowledge of their government, ministries, current issues, and policies.`;

  const user = `Generate realistic official government press releases and announcements from ${country} for the period around ${dateStr}.

Return ONLY a valid JSON object (no markdown):
{
  "country": "${country}",
  "date": "${dateStr}",
  "releases": [
    {
      "title": "Official press release title",
      "ministry": "Specific ministry or office name",
      "summary": "2-3 sentence factual summary of the announcement with specific policy or diplomatic detail",
      "category": "Foreign Policy",
      "source": "Official government website URL or ministry name"
    }
  ]
}
Category must be one of: Foreign Policy, Economy, Defense, Health, Environment, Social, Infrastructure, Justice
Include 3-5 realistic releases.`;

  try {
    const text = await callWithSearchOrFallback(system, user, 3000);
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

  const system = `You are an aviation safety intelligence analyst. Today is ${today()}. Provide realistic airspace status assessment for ${country} based on your knowledge of the current geopolitical situation, ongoing conflicts, FAA/EASA advisories, and regional security conditions.`;

  const user = `Provide a realistic airspace and NOTAM status assessment for ${country}.

Return ONLY a valid JSON object (no markdown):
{
  "country": "${country}",
  "status": "OPEN",
  "alert_level": "GREEN",
  "summary": "2-3 sentence overview of current airspace status based on regional security situation",
  "notams": [
    {
      "id": "NOTAM identifier or N/A",
      "title": "NOTAM short title",
      "detail": "1-2 sentence detail of restriction or advisory",
      "effective": "date range or 'Until further notice'",
      "authority": "FAA / EASA / ICAO / local authority"
    }
  ],
  "restrictions": ["Specific restriction or advisory"],
  "airlines_affected": ["Airline name"],
  "last_updated": "${today()}",
  "source": "FAA / EASA / ICAO"
}
alert_level must be: GREEN (normal), AMBER (caution), RED (avoid), or BLACK (do not fly / closed)
status must be: OPEN, RESTRICTED, CLOSED, or CONFLICT_ZONE
Base your assessment on actual current geopolitical conditions for ${country}.`;

  try {
    const text = await callWithSearchOrFallback(system, user, 3000);
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

  const system = `You are a travel safety analyst with access to US State Department and UK Foreign Office advisory databases. Today is ${today()}. Provide realistic travel advisory assessments for ${country} based on actual published advisory levels and current security conditions.`;

  const user = `Provide the current US State Department and UK Foreign Office travel advisories for ${country}.

Return ONLY a valid JSON object (no markdown):
{
  "country": "${country}",
  "us": {
    "level": "Level 2: Exercise Increased Caution",
    "level_number": 2,
    "summary": "2-3 sentence summary reflecting actual US advisory language and current security situation",
    "key_risks": ["Specific risk 1", "Specific risk 2", "Specific risk 3"],
    "last_updated": "Month Year",
    "url": "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/${country.toLowerCase().replace(/\s+/g,'-')}.html"
  },
  "uk": {
    "level": "Advise against all but essential travel",
    "summary": "2-3 sentence summary reflecting actual UK FCDO language and current conditions",
    "key_risks": ["Specific risk 1", "Specific risk 2"],
    "last_updated": "Month Year",
    "url": "https://www.gov.uk/foreign-travel-advice/${country.toLowerCase().replace(/\s+/g,'-')}"
  }
}
US level_number: 1=Normal Precautions, 2=Increased Caution, 3=Reconsider Travel, 4=Do Not Travel
Use realistic advisory levels appropriate to ${country}'s actual current security situation.`;

  try {
    const text = await callWithSearchOrFallback(system, user, 3000);
    res.json(parseJSON(text));
  } catch (err) {
    console.error("Advisories error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MARKETS COMMENTARY ─────────────────────────────────────────────────────
app.post("/api/markets/commentary", async (req, res) => {
  const system = `You are a senior markets analyst at a major investment bank. Today is ${today()}. Provide expert market commentary based on your knowledge of current global market conditions, commodity prices, and Middle East economic dynamics.`;

  const user = `Provide expert market intelligence commentary for today.

Return ONLY a valid JSON object (no markdown):
{
  "headline": "Today's Market Intelligence — ${today()}",
  "summary": "2-3 sentence overall market commentary reflecting current conditions",
  "oil_commentary": "1-2 sentences on crude oil prices and OPEC+ dynamics",
  "gold_commentary": "1-2 sentences on gold price and safe-haven demand",
  "fx_commentary": "1-2 sentences on USD strength and key currency pairs including AED, SAR",
  "regional_commentary": "1-2 sentences on Gulf and Middle East equity markets (Tadawul, ADX, DFM)",
  "key_data": {
    "wti": "Approx price range e.g. $70-75",
    "brent": "Approx price range e.g. $73-78",
    "gold": "Approx price range e.g. $2,600-2,700",
    "sp500": "Approx level e.g. 5,700-5,900"
  },
  "sources": ["Bloomberg", "Reuters Markets"]
}`;

  try {
    const text = await callWithSearchOrFallback(system, user, 2000);
    res.json(parseJSON(text));
  } catch (err) {
    console.error("Commentary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MARKETS LIVE PRICES ────────────────────────────────────────────────────
// Uses multiple free APIs with fallback chain
app.get("/api/markets/quote", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "Symbols required" });

  // Try Yahoo Finance v8 (most reliable)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/quote?symbols=${encodeURIComponent(symbols)}`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://finance.yahoo.com",
      },
    });
    if (!r.ok) throw new Error(`Yahoo v8: ${r.status}`);
    const data = await r.json();
    const quotes = (data?.quoteResponse?.result || []).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent,
    })).filter(q => q.price != null);
    if (quotes.length > 0) return res.json({ quotes, source: "yahoo_v8" });
    throw new Error("No quotes");
  } catch (e) { console.warn("Yahoo v8 failed:", e.message); }

  // Try Yahoo Finance v7
  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
        "Accept": "*/*",
      },
    });
    if (!r.ok) throw new Error(`Yahoo v7: ${r.status}`);
    const data = await r.json();
    const quotes = (data?.quoteResponse?.result || []).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent,
    })).filter(q => q.price != null);
    if (quotes.length > 0) return res.json({ quotes, source: "yahoo_v7" });
    throw new Error("No quotes");
  } catch (e) { console.warn("Yahoo v7 failed:", e.message); }

  // Final fallback: return AI-generated approximate prices
  try {
    const system = `You are a financial data provider. Today is ${today()}. Return realistic approximate current market prices.`;
    const symbolList = symbols.split(",").slice(0, 15);
    const user = `Provide realistic approximate current market prices for these symbols: ${symbolList.join(", ")}
These are the symbol mappings: CL=F=WTI Crude Oil, BZ=F=Brent Crude, GC=F=Gold, SI=F=Silver, NG=F=Natural Gas, HG=F=Copper, ^GSPC=S&P 500, ^DJI=Dow Jones, ^IXIC=NASDAQ, ^FTSE=FTSE 100, ^GDAXI=DAX, ^N225=Nikkei 225, EURUSD=X=EUR/USD, GBPUSD=X=GBP/USD, USDJPY=X=USD/JPY, USDSAR=X=USD/SAR, USDAED=X=USD/AED, USDKWD=X=USD/KWD

Return ONLY valid JSON array (no markdown):
{"quotes":[{"symbol":"CL=F","name":"WTI Crude Oil","price":72.45,"change":-0.32,"changePercent":-0.44},{"symbol":"BZ=F","name":"Brent Crude","price":75.80,"change":-0.28,"changePercent":-0.37},{"symbol":"GC=F","name":"Gold","price":2665.30,"change":12.50,"changePercent":0.47},{"symbol":"SI=F","name":"Silver","price":29.45,"change":0.15,"changePercent":0.51},{"symbol":"NG=F","name":"Natural Gas","price":3.85,"change":-0.05,"changePercent":-1.28},{"symbol":"HG=F","name":"Copper","price":4.15,"change":0.02,"changePercent":0.48},{"symbol":"^GSPC","name":"S&P 500","price":5732.00,"change":-18.50,"changePercent":-0.32},{"symbol":"^DJI","name":"Dow Jones","price":42880.00,"change":-95.00,"changePercent":-0.22},{"symbol":"^IXIC","name":"NASDAQ","price":18320.00,"change":-42.00,"changePercent":-0.23},{"symbol":"^FTSE","name":"FTSE 100","price":8215.00,"change":22.00,"changePercent":0.27},{"symbol":"^GDAXI","name":"DAX","price":22450.00,"change":85.00,"changePercent":0.38},{"symbol":"^N225","name":"Nikkei 225","price":37800.00,"change":-120.00,"changePercent":-0.32},{"symbol":"EURUSD=X","name":"EUR/USD","price":1.0842,"change":0.0008,"changePercent":0.07},{"symbol":"GBPUSD=X","name":"GBP/USD","price":1.2891,"change":-0.0012,"changePercent":-0.09},{"symbol":"USDJPY=X","name":"USD/JPY","price":148.95,"change":0.45,"changePercent":0.30},{"symbol":"USDSAR=X","name":"USD/SAR","price":3.7502,"change":0.0001,"changePercent":0.00},{"symbol":"USDAED=X","name":"USD/AED","price":3.6725,"change":0.0000,"changePercent":0.00},{"symbol":"USDKWD=X","name":"USD/KWD","price":0.3075,"change":0.0001,"changePercent":0.03}],"source":"ai_estimate"}

Replace example values with your best estimate of current realistic prices.`;

    const text = await callClaude(system, user, 2000);
    return res.json(parseJSON(text));
  } catch (aiErr) {
    console.error("AI market fallback error:", aiErr.message);
    return res.status(500).json({ error: "Markets unavailable: " + aiErr.message });
  }
});

// ── HEALTH CHECK ───────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), model: MODEL });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Briefly backend running on port ${PORT}`));
