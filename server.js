const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";

// ── CLAUDE HELPER ──────────────────────────────────────────────────────────
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

// ── RSS PARSER ─────────────────────────────────────────────────────────────
async function fetchRSS(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BrieflyBot/1.0)",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
    },
  });
  if (!r.ok) throw new Error(`RSS fetch failed: ${r.status}`);
  const xml = await r.text();

  // Parse items from XML
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
    const link = (item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) ||
                  item.match(/<guid[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^\s<]+)(?:\]\]>)?<\/guid>/) || [])[1] || "";
    const desc = (item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || "";
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    if (title.trim()) {
      items.push({
        title: title.trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, ""),
        link: link.trim(),
        description: desc.replace(/<[^>]+>/g, "").trim().slice(0, 200).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
        pubDate: pubDate.trim(),
      });
    }
  }
  return items.slice(0, 8);
}

// RSS feeds by topic
const RSS_FEEDS = {
  World: [
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters", sourceUrl: "https://reuters.com" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", source: "NY Times", sourceUrl: "https://nytimes.com" },
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC News", sourceUrl: "https://bbc.com/news" },
  ],
  Technology: [
    { url: "https://feeds.reuters.com/reuters/technologyNews", source: "Reuters Tech", sourceUrl: "https://reuters.com/technology" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", source: "NY Times Tech", sourceUrl: "https://nytimes.com/section/technology" },
    { url: "https://feeds.bbci.co.uk/news/technology/rss.xml", source: "BBC Tech", sourceUrl: "https://bbc.com/news/technology" },
  ],
  Finance: [
    { url: "https://feeds.reuters.com/reuters/businessNews", source: "Reuters Business", sourceUrl: "https://reuters.com/business" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", source: "NY Times Business", sourceUrl: "https://nytimes.com/section/business" },
  ],
  Geopolitics: [
    { url: "https://feeds.reuters.com/Reuters/worldNews", source: "Reuters World", sourceUrl: "https://reuters.com/world" },
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World", sourceUrl: "https://bbc.com/news/world" },
  ],
  Science: [
    { url: "https://feeds.reuters.com/reuters/scienceNews", source: "Reuters Science", sourceUrl: "https://reuters.com/science" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml", source: "NY Times Science", sourceUrl: "https://nytimes.com/section/science" },
  ],
  Climate: [
    { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", source: "BBC Environment", sourceUrl: "https://bbc.com/news/science_and_environment" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/Climate.xml", source: "NY Times Climate", sourceUrl: "https://nytimes.com/section/climate" },
  ],
  Health: [
    { url: "https://feeds.reuters.com/reuters/healthNews", source: "Reuters Health", sourceUrl: "https://reuters.com/business/healthcare-pharmaceuticals" },
    { url: "https://feeds.bbci.co.uk/news/health/rss.xml", source: "BBC Health", sourceUrl: "https://bbc.com/news/health" },
  ],
  Defense: [
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters World", sourceUrl: "https://reuters.com/world" },
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World", sourceUrl: "https://bbc.com/news/world" },
  ],
};

// ── LIVE NEWS (RSS) ────────────────────────────────────────────────────────
app.post("/api/news", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  const feeds = RSS_FEEDS[topic] || RSS_FEEDS.World;
  const allItems = [];

  // Try each RSS feed
  for (const feed of feeds) {
    try {
      const items = await fetchRSS(feed.url);
      items.forEach(item => allItems.push({ ...item, source: feed.source, sourceUrl: feed.sourceUrl }));
    } catch (e) {
      console.warn(`RSS failed for ${feed.source}:`, e.message);
    }
  }

  // Also try Google News RSS as fallback/supplement
  try {
    const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
    const googleItems = await fetchRSS(googleUrl);
    googleItems.forEach(item => allItems.push({ ...item, source: "Google News", sourceUrl: `https://news.google.com/search?q=${encodeURIComponent(topic)}` }));
  } catch (e) {
    console.warn("Google News RSS failed:", e.message);
  }

  if (allItems.length > 0) {
    // Return real RSS items
    const items = allItems.slice(0, 6).map(item => ({
      title: item.title,
      body: item.description || "Click to read the full story.",
      sources: item.source,
      sourceUrl: item.sourceUrl,
      link: item.link,
      pubDate: item.pubDate,
      isLive: true,
    }));

    return res.json({
      headline: `Live: ${topic} Headlines`,
      summary: `Real-time news from ${[...new Set(allItems.map(i => i.source))].slice(0, 3).join(", ")} and other sources.`,
      items,
      isLive: true,
      fetchedAt: new Date().toISOString(),
    });
  }

  // Fallback to Claude if all RSS fails
  try {
    const text = await callClaude(
      `You are a news intelligence editor. Today: ${todayStr()}. Return only valid JSON, no markdown.`,
      `Latest news briefing on "${topic}". JSON: {"headline":"Breaking: [title]","summary":"1-2 sentence overview","items":[{"title":"headline","body":"2-3 sentences","sources":"Reuters/AP","link":"https://reuters.com","isLive":false},{"title":"headline","body":"2-3 sentences","sources":"BBC","link":"https://bbc.com/news","isLive":false},{"title":"headline","body":"2-3 sentences","sources":"FT","link":"https://ft.com","isLive":false},{"title":"headline","body":"2-3 sentences","sources":"Bloomberg","link":"https://bloomberg.com","isLive":false}],"isLive":false}`,
      1200
    );
    return res.json(parseJSON(text));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── LIVE RSS PROXY (for ticker) ────────────────────────────────────────────
app.get("/api/rss/breaking", async (req, res) => {
  const feeds = [
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters", sourceUrl: "https://reuters.com" },
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC", sourceUrl: "https://bbc.com/news" },
    { url: "https://feeds.reuters.com/reuters/businessNews", source: "Reuters Business", sourceUrl: "https://reuters.com/business" },
  ];
  const items = [];
  for (const feed of feeds) {
    try {
      const rssItems = await fetchRSS(feed.url);
      rssItems.slice(0, 3).forEach(item => items.push({ ...item, source: feed.source, sourceUrl: feed.sourceUrl }));
    } catch (e) { console.warn("Breaking RSS failed:", e.message); }
  }
  res.json({ items: items.slice(0, 12) });
});

// ── BRIEFING ─────────────────────────────────────────────────────────────
app.post("/api/briefing", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });
  try {
    const text = await callClaude(
      `You are a senior intelligence analyst. Today: ${todayStr()}. Be specific. Return only valid JSON, no markdown.`,
      `Intelligence briefing on "${topic}". JSON: {"executive":"3-4 sentences","ngo":"2-3 sentences on humanitarian/NGO impact","geopolitical":"3-4 sentences on key actors and positions","social":"2-3 sentences on public sentiment","strategic":"3-4 sentences on strategic implications","market":"2-3 sentences on market/economic impact","sources":[{"name":"Reuters","url":"https://reuters.com"},{"name":"AP News","url":"https://apnews.com"},{"name":"BBC News","url":"https://bbc.com/news"}],"searchLinks":{"reuters":"https://www.reuters.com/search/news?blob=${encodeURIComponent(topic)}","bbc":"https://www.bbc.com/search?q=${encodeURIComponent(topic)}","ap":"https://apnews.com/search?q=${encodeURIComponent(topic)}"}}`,
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
      `Official government press releases from ${country} around ${dateStr}. Include 3-4 releases. JSON: {"country":"${country}","date":"${dateStr}","releases":[{"title":"title","ministry":"ministry","summary":"2-3 sentences","category":"Foreign Policy","source":"source name","sourceUrl":"https://official-url.gov","verifyUrl":"https://www.google.com/search?q=official+press+release+${encodeURIComponent(country)}+government"}]}
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
      `Airspace and NOTAM status for ${country}. JSON: {"country":"${country}","status":"OPEN","alert_level":"GREEN","summary":"2-3 sentences on current airspace status","notams":[{"id":"N/A","title":"title","detail":"1-2 sentences","effective":"ongoing","authority":"ICAO"}],"restrictions":["restriction"],"airlines_affected":["airline"],"last_updated":"${todayStr()}","source":"ICAO/EASA/FAA","verifyLinks":[{"label":"FAA NOTAMs","url":"https://notams.aim.faa.gov/notamSearch/"},{"label":"EASA Safety","url":"https://www.easa.europa.eu/en/domains/air-operations/flight-standards-and-airworthiness/safety-information-bulletin"},{"label":"ICAO","url":"https://www.icao.int/safety/airnavigation/pages/notam.aspx"},{"label":"Google Search","url":"https://www.google.com/search?q=${encodeURIComponent(country)}+airspace+NOTAM+restrictions+2025"}]}
status: OPEN|RESTRICTED|CLOSED|CONFLICT_ZONE. alert_level: GREEN|AMBER|RED|BLACK`,
      1000
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
  const slug = country.toLowerCase().replace(/\s+/g, "-");
  try {
    const text = await callClaude(
      `You are a travel safety analyst. Today: ${todayStr()}. Return only valid JSON, no markdown.`,
      `US and UK travel advisories for ${country}. JSON: {"country":"${country}","us":{"level":"Level 2: Exercise Increased Caution","level_number":2,"summary":"2-3 sentences","key_risks":["risk1","risk2"],"last_updated":"${todayStr()}","url":"https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/${slug}.html"},"uk":{"level":"Advise against all but essential travel","summary":"2-3 sentences","key_risks":["risk1","risk2"],"last_updated":"${todayStr()}","url":"https://www.gov.uk/foreign-travel-advice/${slug}"}}
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
      `Market intelligence commentary. JSON: {"headline":"Market Intelligence — ${todayStr()}","summary":"2-3 sentences on global markets","oil_commentary":"1-2 sentences on crude oil","gold_commentary":"1-2 sentences on gold","fx_commentary":"1-2 sentences on USD/major currencies","regional_commentary":"1-2 sentences on Gulf/Middle East markets","key_data":{"wti":"~$70-75","brent":"~$73-78","gold":"~$2,600-2,700","sp500":"~5,700-5,900"},"sources":[{"name":"Bloomberg Markets","url":"https://bloomberg.com/markets"},{"name":"Reuters Markets","url":"https://reuters.com/markets"},{"name":"FT Markets","url":"https://ft.com/markets"},{"name":"CNBC","url":"https://cnbc.com/markets"}]}`,
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

  // AI fallback
  try {
    const text = await callClaude(
      `Financial data assistant. Return only valid JSON, no markdown.`,
      `Realistic current approximate prices. JSON: {"quotes":[{"symbol":"CL=F","name":"WTI Crude Oil","price":72.45,"change":-0.32,"changePercent":-0.44},{"symbol":"BZ=F","name":"Brent Crude","price":75.80,"change":-0.28,"changePercent":-0.37},{"symbol":"GC=F","name":"Gold","price":2665.30,"change":12.50,"changePercent":0.47},{"symbol":"SI=F","name":"Silver","price":29.45,"change":0.15,"changePercent":0.51},{"symbol":"NG=F","name":"Natural Gas","price":3.85,"change":-0.05,"changePercent":-1.28},{"symbol":"HG=F","name":"Copper","price":4.15,"change":0.02,"changePercent":0.48},{"symbol":"^GSPC","name":"S&P 500","price":5732.00,"change":-18.50,"changePercent":-0.32},{"symbol":"^DJI","name":"Dow Jones","price":42880.00,"change":-95.00,"changePercent":-0.22},{"symbol":"^IXIC","name":"NASDAQ","price":18320.00,"change":-42.00,"changePercent":-0.23},{"symbol":"^FTSE","name":"FTSE 100","price":8215.00,"change":22.00,"changePercent":0.27},{"symbol":"^GDAXI","name":"DAX","price":22450.00,"change":85.00,"changePercent":0.38},{"symbol":"^N225","name":"Nikkei 225","price":37800.00,"change":-120.00,"changePercent":-0.32},{"symbol":"EURUSD=X","name":"EUR/USD","price":1.0842,"change":0.0008,"changePercent":0.07},{"symbol":"GBPUSD=X","name":"GBP/USD","price":1.2891,"change":-0.0012,"changePercent":-0.09},{"symbol":"USDJPY=X","name":"USD/JPY","price":148.95,"change":0.45,"changePercent":0.30},{"symbol":"USDSAR=X","name":"USD/SAR","price":3.7502,"change":0.0001,"changePercent":0.00},{"symbol":"USDAED=X","name":"USD/AED","price":3.6725,"change":0.0000,"changePercent":0.00},{"symbol":"USDKWD=X","name":"USD/KWD","price":0.3075,"change":0.0001,"changePercent":0.03}],"source":"ai_estimate"}`,
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
