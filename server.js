const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";

// ── HELPER: Anthropic with web search ─────────────────────────────────────
async function callWithSearch(systemPrompt, userPrompt, maxTokens = 2000) {
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
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(start, end + 1));
}

// ── BRIEFING ───────────────────────────────────────────────────────────────
app.post("/api/briefing", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic is required" });
  const system = `You are a senior intelligence analyst. Use web_search to find the LATEST news. Only cite credible sources: Reuters, AP, BBC, AFP, .gov sites, UN, WHO, IMF, FT, The Economist, Foreign Affairs, Nature, JAMA.`;
  const user = `Search for the very latest news on: "${topic}". Return ONLY valid JSON:
{"executive":"3-4 sentences","ngo":"2-3 sentences","geopolitical":"3-4 sentences","social":"2-3 sentences","strategic":"3-4 sentences","market":"2-3 sentences","sources":["source1","source2","source3"]}`;
  try {
    const text = await callWithSearch(system, user);
    res.json({ analysis: parseJSON(text) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NEWS ───────────────────────────────────────────────────────────────────
app.post("/api/news", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic is required" });
  const system = `You are a live news aggregator. Use web_search to find TODAY's news. Use only: Reuters, AP, BBC, AFP, gov sites, FT, Bloomberg, The Economist.`;
  const user = `Search today's latest news on: "${topic}". Return ONLY valid JSON:
{"headline":"title","summary":"1-2 sentences","items":[{"title":"","body":"2-3 sentences","sources":""},{"title":"","body":"","sources":""},{"title":"","body":"","sources":""},{"title":"","body":"","sources":""}]}`;
  try {
    const text = await callWithSearch(system, user);
    res.json(parseJSON(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PRESS RELEASES ─────────────────────────────────────────────────────────
app.post("/api/press-releases", async (req, res) => {
  const { country, date } = req.body;
  if (!country) return res.status(400).json({ error: "Country is required" });
  const dateStr = date || new Date().toISOString().split("T")[0];
  const system = `You are a government communications monitor. Use web_search to find official press releases from ${country}'s government. Focus on official government websites, ministry announcements, head of state statements.`;
  const user = `Search for official government press releases from ${country} around ${dateStr}. Return ONLY valid JSON:
{"country":"${country}","date":"${dateStr}","releases":[{"title":"","ministry":"","summary":"2-3 sentences","category":"Foreign Policy|Economy|Defense|Health|Environment|Social|Infrastructure|Justice","source":""}]}`;
  try {
    const text = await callWithSearch(system, user);
    res.json(parseJSON(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AIRSPACE ───────────────────────────────────────────────────────────────
app.post("/api/airspace", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country is required" });
  const system = `You are an aviation safety intelligence analyst. Use web_search to find the LATEST airspace status, NOTAMs, flight bans, and aviation advisories for ${country}. Search FAA, EASA, ICAO, official aviation authority websites, and aviation news sources.`;
  const user = `Search for the latest NOTAMs, airspace restrictions, flight bans, and aviation safety status for ${country}. Include any active conflict-zone warnings, overflight restrictions, or altitude restrictions.

Return ONLY valid JSON:
{
  "country": "${country}",
  "status": "OPEN|RESTRICTED|CLOSED|CONFLICT_ZONE",
  "alert_level": "GREEN|AMBER|RED|BLACK",
  "summary": "2-3 sentence overview of current airspace status",
  "notams": [
    {"id": "NOTAM identifier or N/A", "title": "short title", "detail": "1-2 sentence detail", "effective": "date or ongoing", "authority": "issuing authority"}
  ],
  "restrictions": ["restriction 1", "restriction 2"],
  "airlines_affected": ["airline 1", "airline 2"],
  "last_updated": "today's date",
  "source": "primary source name"
}`;
  try {
    const text = await callWithSearch(system, user, 1500);
    res.json(parseJSON(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TRAVEL ADVISORIES ──────────────────────────────────────────────────────
app.post("/api/advisories", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country is required" });
  const system = `You are a travel safety analyst. Use web_search to find the CURRENT official travel advisories from:
1. US State Department: travel.state.gov
2. UK Foreign Office: gov.uk/foreign-travel-advice
Search both sources for ${country} and extract the exact current advisory level and key warnings.`;
  const user = `Search travel.state.gov and gov.uk/foreign-travel-advice for the current official travel advisory for ${country}.

Return ONLY valid JSON:
{
  "country": "${country}",
  "us": {
    "level": "Level 1: Exercise Normal Precautions | Level 2: Exercise Increased Caution | Level 3: Reconsider Travel | Level 4: Do Not Travel",
    "level_number": 1,
    "summary": "2-3 sentence summary of US advisory",
    "key_risks": ["risk 1", "risk 2", "risk 3"],
    "last_updated": "date",
    "url": "https://travel.state.gov/..."
  },
  "uk": {
    "level": "Advise against all travel | Advise against all but essential travel | Some parts advise against travel | No specific warnings",
    "summary": "2-3 sentence summary of UK advisory",
    "key_risks": ["risk 1", "risk 2"],
    "last_updated": "date",
    "url": "https://www.gov.uk/foreign-travel-advice/..."
  }
}`;
  try {
    const text = await callWithSearch(system, user, 1500);
    res.json(parseJSON(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MARKETS COMMENTARY ─────────────────────────────────────────────────────
app.post("/api/markets/commentary", async (req, res) => {
  const system = `You are a senior markets analyst. Use web_search to find TODAY's market commentary, focusing on oil prices, gold, Middle East economies, and global indices.`;
  const user = `Search for today's key market movements and commentary on oil, gold, Middle East stocks, and global indices. Return ONLY valid JSON:
{"headline":"Today's market summary title","summary":"2-3 sentence overall market commentary based on today's data","oil_commentary":"1-2 sentences on crude oil","gold_commentary":"1-2 sentences on gold","fx_commentary":"1-2 sentences on USD/AED/SAR/major currencies","regional_commentary":"1-2 sentences on Middle East markets","sources":["source1","source2"]}`;
  try {
    const text = await callWithSearch(system, user, 1000);
    res.json(parseJSON(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YAHOO FINANCE PROXY ────────────────────────────────────────────────────
app.get("/api/markets/quote", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "Symbols required" });
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName,regularMarketTime`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const data = await response.json();
    const quotes = (data?.quoteResponse?.result || []).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent,
      time: q.regularMarketTime,
    }));
    res.json({ quotes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Briefly backend running on port ${PORT}`));
