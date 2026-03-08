const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";
const VERSION = "3.2";

// ── CLAUDE HELPER ─────────────────────────────────────────────────────────────
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
    throw new Error("API " + r.status + ": " + t.slice(0, 200));
  }
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const text = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  if (!text.trim()) throw new Error("Empty response");
  return text;
}

// Fixed parseJSON: finds outermost { } correctly for nested objects
function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "{") { if (depth === 0) start = i; depth++; }
    else if (clean[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (start === -1 || end === -1) throw new Error("No JSON object found in response");
  return JSON.parse(clean.slice(start, end + 1));
}

const todayStr = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

// ── RSS PARSER with timeout ────────────────────────────────────────────────────
async function fetchRSS(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BrieflyBot/3.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!r.ok) throw new Error("RSS " + r.status);
    const xml = await r.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
      const link = (item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) ||
                    item.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/) || [])[1] || "";
      const desc = (item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || "";
      const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
      if (title.trim()) {
        const cleanTitle = title.trim()
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&#\d+;/g, "").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        const cleanDesc = desc
          .replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#\d+;/g, "")
          .replace(/\s+/g, " ").trim().slice(0, 220);
        items.push({ title: cleanTitle, link: link.trim(), description: cleanDesc, pubDate: pubDate.trim() });
      }
    }
    return items.slice(0, 8);
  } finally {
    clearTimeout(timer);
  }
}

// ── RSS FEEDS BY REGION (aligned with frontend) ───────────────────────────────
const RSS_FEEDS = {
  "Global/World": [
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters", sourceUrl: "https://reuters.com" },
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC News", sourceUrl: "https://bbc.com/news" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera", sourceUrl: "https://aljazeera.com" },
    { url: "https://feeds.ap.org/rss/apf-topnews", source: "AP News", sourceUrl: "https://apnews.com" },
    { url: "https://www.theguardian.com/world/rss", source: "The Guardian", sourceUrl: "https://theguardian.com/world" },
    { url: "https://rss.upi.com/news/world-news.rss", source: "UPI", sourceUrl: "https://upi.com/news/world-news" },
  ],
  "North America": [
    { url: "https://feeds.ap.org/rss/apf-topnews", source: "AP News", sourceUrl: "https://apnews.com" },
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters", sourceUrl: "https://reuters.com" },
    { url: "https://rss.upi.com/news/us-news.rss", source: "UPI", sourceUrl: "https://upi.com/news/us-news" },
    { url: "https://rss.cnn.com/rss/edition_us.rss", source: "CNN", sourceUrl: "https://cnn.com/us" },
    { url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", source: "BBC Americas", sourceUrl: "https://bbc.com/news/world/us_and_canada" },
    { url: "https://www.theguardian.com/us-news/rss", source: "The Guardian US", sourceUrl: "https://theguardian.com/us-news" },
  ],
  "Europe": [
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters", sourceUrl: "https://reuters.com" },
    { url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml", source: "BBC Europe", sourceUrl: "https://bbc.com/news/world/europe" },
    { url: "https://www.theguardian.com/world/europe-news/rss", source: "The Guardian", sourceUrl: "https://theguardian.com/world/europe-news" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera", sourceUrl: "https://aljazeera.com" },
    { url: "https://feeds.ap.org/rss/apf-europe", source: "AP Europe", sourceUrl: "https://apnews.com/world-news/europe" },
  ],
  "Asia": [
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters", sourceUrl: "https://reuters.com" },
    { url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml", source: "BBC Asia", sourceUrl: "https://bbc.com/news/world/asia" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera", sourceUrl: "https://aljazeera.com" },
    { url: "https://feeds.ap.org/rss/apf-asiapacific", source: "AP Asia", sourceUrl: "https://apnews.com/world-news/asia-pacific" },
    { url: "https://www3.nhk.or.jp/rss/news/cat0.xml", source: "NHK World", sourceUrl: "https://nhk.or.jp/nhkworld" },
  ],
  "Middle East & Africa": [
    { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera", sourceUrl: "https://aljazeera.com" },
    { url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", source: "BBC Middle East", sourceUrl: "https://bbc.com/news/world/middle_east" },
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters", sourceUrl: "https://reuters.com" },
    { url: "https://feeds.ap.org/rss/apf-middleeast", source: "AP Middle East", sourceUrl: "https://apnews.com/world-news/middle-east" },
    { url: "https://feeds.bbci.co.uk/news/world/africa/rss.xml", source: "BBC Africa", sourceUrl: "https://bbc.com/news/world/africa" },
  ],
  "South America": [
    { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters", sourceUrl: "https://reuters.com" },
    { url: "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml", source: "BBC LatAm", sourceUrl: "https://bbc.com/news/world/latin_america" },
    { url: "https://feeds.ap.org/rss/apf-latinamerica", source: "AP LatAm", sourceUrl: "https://apnews.com/world-news/latin-america" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera", sourceUrl: "https://aljazeera.com" },
  ],
};

const BREAKING_FEEDS = [
  { url: "https://feeds.reuters.com/reuters/worldNews", source: "Reuters" },
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  { url: "https://feeds.ap.org/rss/apf-topnews", source: "AP News" },
  { url: "https://rss.upi.com/news/world-news.rss", source: "UPI" },
  { url: "https://rss.cnn.com/rss/edition.rss", source: "CNN" },
];

// ── LIVE NEWS ─────────────────────────────────────────────────────────────────
app.post("/api/news", async (req, res) => {
  const { topic, search } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  const allItems = [];

  if (search && search.trim()) {
    try {
      const items = await fetchRSS(
        "https://news.google.com/rss/search?q=" + encodeURIComponent(search) + "&hl=en-US&gl=US&ceid=US:en"
      );
      items.forEach(item => allItems.push({ ...item, source: "Google News", sourceUrl: "https://news.google.com" }));
    } catch (e) { console.warn("Search RSS failed:", e.message); }
    try {
      const items = await fetchRSS(
        "https://news.google.com/rss/search?q=" + encodeURIComponent(search + " site:reuters.com") + "&hl=en-US&gl=US&ceid=US:en",
        4000
      );
      items.forEach(item => allItems.push({ ...item, source: "Reuters", sourceUrl: "https://reuters.com" }));
    } catch (e) { /* silent */ }
  } else {
    const feeds = RSS_FEEDS[topic] || RSS_FEEDS["Global/World"];
    for (const feed of feeds) {
      try {
        const items = await fetchRSS(feed.url);
        items.forEach(item => allItems.push({ ...item, source: feed.source, sourceUrl: feed.sourceUrl }));
      } catch (e) { console.warn("RSS failed for " + feed.source + ":", e.message); }
    }
  }

  if (allItems.length > 0) {
    const seen = new Set();
    const unique = allItems.filter(i => {
      const key = i.title.slice(0, 50).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return res.json({
      headline: search ? 'Search: "' + search + '"' : topic + " Headlines",
      summary: "Live news from " + [...new Set(unique.map(i => i.source))].slice(0, 4).join(", ") + " and other sources.",
      items: unique.slice(0, 10).map(item => ({
        title: item.title,
        body: item.description || "",
        sources: item.source,
        sourceUrl: item.sourceUrl,
        link: item.link,
        pubDate: item.pubDate,
        isLive: true,
      })),
      isLive: true,
      fetchedAt: new Date().toISOString(),
    });
  }

  // Claude fallback
  try {
    const q = search || topic;
    const text = await callClaude(
      "You are a news intelligence editor. Today: " + todayStr() + ". Return only valid JSON, no markdown.",
      "Latest news for: \"" + q + "\". Return JSON: {\"headline\":\"headline\",\"summary\":\"overview\",\"items\":[{\"title\":\"headline\",\"body\":\"2-3 sentences\",\"sources\":\"Reuters\",\"link\":\"https://reuters.com\",\"isLive\":false},{\"title\":\"headline\",\"body\":\"2-3 sentences\",\"sources\":\"BBC\",\"link\":\"https://bbc.com/news\",\"isLive\":false},{\"title\":\"headline\",\"body\":\"2-3 sentences\",\"sources\":\"AP News\",\"link\":\"https://apnews.com\",\"isLive\":false}],\"isLive\":false}",
      1200
    );
    return res.json(parseJSON(text));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── BREAKING TICKER ───────────────────────────────────────────────────────────
app.get("/api/rss/breaking", async (req, res) => {
  const items = [];
  for (const feed of BREAKING_FEEDS) {
    try {
      const rssItems = await fetchRSS(feed.url, 5000);
      rssItems.slice(0, 2).forEach(item => items.push({ ...item, source: feed.source }));
    } catch (e) { /* silent */ }
  }
  res.json({ items: items.slice(0, 18) });
});

// ── INTELLIGENCE BRIEFING ─────────────────────────────────────────────────────
app.post("/api/briefing", async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  let liveContext = "";
  try {
    const items = await fetchRSS(
      "https://news.google.com/rss/search?q=" + encodeURIComponent(topic) + "&hl=en-US&gl=US&ceid=US:en",
      5000
    );
    if (items.length > 0) {
      liveContext = "Recent headlines:\n" + items.slice(0, 6).map(i => "- " + i.title).join("\n") + "\n\n";
    }
  } catch (e) { /* silent */ }

  const su = encodeURIComponent(topic);

  try {
    const text = await callClaude(
      "You are a senior intelligence analyst. Today: " + todayStr() + ". Respond ONLY with a valid JSON object. No markdown, no preamble.",
      liveContext + "Write a comprehensive intelligence briefing about: " + topic + "\n\nRespond with this exact JSON (replace angle-bracket placeholders with real content):\n{\"executive\":\"<3-4 sentence executive summary>\",\"geopolitical\":\"<3-4 sentences on key actors and geopolitical implications>\",\"humanitarian\":\"<2-3 sentences on humanitarian and civilian impact>\",\"economic\":\"<2-3 sentences on economic and market impact>\",\"social\":\"<2-3 sentences on public sentiment and social dynamics>\",\"strategic\":\"<3-4 sentences on strategic outlook and key risks>\",\"sources\":[{\"name\":\"Reuters\",\"url\":\"https://reuters.com/search/news?blob=" + su + "\"},{\"name\":\"AP News\",\"url\":\"https://apnews.com/search?q=" + su + "\"},{\"name\":\"Al Jazeera\",\"url\":\"https://aljazeera.com/search?q=" + su + "\"},{\"name\":\"BBC News\",\"url\":\"https://bbc.com/search?q=" + su + "\"},{\"name\":\"Bloomberg\",\"url\":\"https://bloomberg.com/search?query=" + su + "\"}]}",
      1800
    );
    res.json({ analysis: parseJSON(text) });
  } catch (e) {
    console.error("Briefing error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PRESS RELEASES ────────────────────────────────────────────────────────────
app.post("/api/press-releases", async (req, res) => {
  const { region } = req.body;
  if (!region) return res.status(400).json({ error: "Region required" });

  let liveContext = "";
  try {
    const items = await fetchRSS(
      "https://news.google.com/rss/search?q=" + encodeURIComponent("government official statement " + region) + "&hl=en-US&gl=US&ceid=US:en",
      5000
    );
    if (items.length > 0) {
      liveContext = "Recent headlines:\n" + items.slice(0, 4).map(i => "- " + i.title).join("\n") + "\n\n";
    }
  } catch (e) { /* silent */ }

  try {
    const text = await callClaude(
      "You are a government communications monitor. Today: " + todayStr() + ". Respond ONLY with a valid JSON object. No markdown or extra text.",
      liveContext + "List 5-6 recent official government press releases and statements from the " + region + " region.\n\nRespond with this exact JSON:\n{\"region\":\"" + region + "\",\"date\":\"" + todayStr() + "\",\"releases\":[{\"title\":\"<title>\",\"country\":\"<country>\",\"ministry\":\"<ministry>\",\"summary\":\"<2-3 sentence summary>\",\"category\":\"<Foreign Policy|Economy|Defense|Health|Environment|Social|Infrastructure|Justice>\",\"source\":\"<source name>\",\"sourceUrl\":\"<https://official.gov.url>\",\"flag\":\"<emoji flag>\"}]}",
      1400
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("Press error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AIRSPACE / NOTAMs ─────────────────────────────────────────────────────────
app.post("/api/airspace", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });

  let liveContext = "";
  try {
    const items = await fetchRSS(
      "https://news.google.com/rss/search?q=" + encodeURIComponent(country + " airspace NOTAM aviation FlightRadar24") + "&hl=en-US&gl=US&ceid=US:en",
      5000
    );
    if (items.length > 0) {
      liveContext = "Recent aviation news:\n" + items.slice(0, 4).map(i => "- " + i.title).join("\n") + "\n\n";
    }
  } catch (e) { /* silent */ }

  const fr24Url = "https://www.flightradar24.com/" + encodeURIComponent(country.toLowerCase().replace(/\s+/g, "-"));
  const googleSearch = "https://www.google.com/search?q=" + encodeURIComponent(country + " airspace NOTAM " + new Date().getFullYear());

  try {
    const text = await callClaude(
      "You are an aviation safety analyst with knowledge of FlightRadar24, FAA, EUROCONTROL, and ICAO data. Today: " + todayStr() + ". Respond ONLY with a valid JSON object. No markdown or extra text.",
      liveContext + "Provide current airspace status and NOTAM summary for " + country + ". Reference FlightRadar24 live flight data and official NOTAM systems.\n\nRespond with this JSON:\n{\"country\":\"" + country + "\",\"status\":\"<OPEN|RESTRICTED|CLOSED|CONFLICT_ZONE>\",\"alert_level\":\"<GREEN|AMBER|RED|BLACK>\",\"summary\":\"<2-3 sentences on current airspace status, referencing live flight activity where known>\",\"notams\":[{\"id\":\"<ID or N/A>\",\"title\":\"<NOTAM title>\",\"detail\":\"<1-2 sentences>\",\"effective\":\"<date or ongoing>\",\"authority\":\"<FAA|EASA|ICAO|GCAA|CAA>\"}],\"restrictions\":[\"<restriction1>\",\"<restriction2>\"],\"airlines_affected\":[\"<airline>\"],\"last_updated\":\"" + todayStr() + "\",\"data_sources\":\"FlightRadar24, FAA NOTAM System, EUROCONTROL, ICAO, EASA\",\"verifyLinks\":[{\"label\":\"FlightRadar24\",\"url\":\"" + fr24Url + "\"},{\"label\":\"FAA NOTAMs\",\"url\":\"https://notams.aim.faa.gov/notamSearch/\"},{\"label\":\"EUROCONTROL\",\"url\":\"https://www.eurocontrol.int/publication/notam-summary\"},{\"label\":\"EASA Safety\",\"url\":\"https://www.easa.europa.eu/en/domains/air-operations\"},{\"label\":\"ICAO\",\"url\":\"https://www.icao.int/safety/airnavigation/pages/notam.aspx\"}]}",
      1200
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("Airspace error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── TRAVEL ADVISORIES ─────────────────────────────────────────────────────────
app.post("/api/advisories", async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });

  const slug = country.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "");
  const usUrl = "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/" + slug + ".html";
  const usEmbassySearch = "https://www.google.com/search?q=US+embassy+" + encodeURIComponent(country) + "+site:travel.state.gov";
  const ukUrl = "https://www.gov.uk/foreign-travel-advice/" + slug;
  const ukEmbassySearch = "https://www.google.com/search?q=UK+embassy+" + encodeURIComponent(country) + "+site:gov.uk";

  try {
    const text = await callClaude(
      "You are a travel safety analyst with direct knowledge of US State Department, US Embassy advisories, UK FCDO, and UK Embassy travel warnings worldwide. Today: " + todayStr() + ". Respond ONLY with a valid JSON object. No markdown or extra text.",
      "Provide the current US State Department / US Embassy and UK FCDO / UK Embassy travel advisories for " + country + ". Include both the official government advisory level and any specific warnings issued by the US and UK embassies in-country.\n\nRespond with this JSON:\n{\"country\":\"" + country + "\",\"us\":{\"level\":\"<e.g. Level 2: Exercise Increased Caution>\",\"level_number\":<1-4>,\"summary\":\"<2-3 sentences including any US Embassy-specific warnings>\",\"key_risks\":[\"<risk1>\",\"<risk2>\",\"<risk3>\"],\"embassy_note\":\"<1 sentence: any specific US Embassy alert or warning if applicable, else empty string>\",\"last_updated\":\"" + todayStr() + "\",\"url\":\"" + usUrl + "\",\"embassy_url\":\"https://www." + slug + ".usembassy.gov\",\"source\":\"U.S. Department of State / U.S. Embassy\"},\"uk\":{\"level\":\"<e.g. Advise against all but essential travel>\",\"summary\":\"<2-3 sentences including any UK Embassy-specific warnings>\",\"key_risks\":[\"<risk1>\",\"<risk2>\",\"<risk3>\"],\"embassy_note\":\"<1 sentence: any specific UK Embassy alert if applicable, else empty string>\",\"last_updated\":\"" + todayStr() + "\",\"url\":\"" + ukUrl + "\",\"source\":\"UK Foreign, Commonwealth & Development Office / UK Embassy\"}}\nUS level_number: 1=Normal, 2=Caution, 3=Reconsider, 4=Do Not Travel",
      1200
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("Advisory error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── MARKETS COMMENTARY ────────────────────────────────────────────────────────
app.post("/api/markets/commentary", async (req, res) => {
  try {
    const text = await callClaude(
      "You are a senior markets analyst. Today: " + todayStr() + ". Respond ONLY with a valid JSON object. No markdown or extra text.",
      "Write a global market intelligence commentary based on your knowledge of current market conditions.\n\nRespond with this JSON:\n{\"headline\":\"Market Intelligence — " + todayStr() + "\",\"summary\":\"<2-3 sentences on overall global market sentiment>\",\"us_commentary\":\"<2-3 sentences on US equities including S&P 500, Dow, Nasdaq>\",\"europe_commentary\":\"<1-2 sentences on European markets>\",\"asia_commentary\":\"<1-2 sentences on Asian markets>\",\"mideast_commentary\":\"<1-2 sentences on Middle East markets including Tadawul and DFM>\",\"oil_commentary\":\"<1-2 sentences on crude oil WTI and Brent>\",\"gold_commentary\":\"<1-2 sentences on gold and silver>\",\"fx_commentary\":\"<1-2 sentences on USD and major currencies>\",\"sources\":[{\"name\":\"Yahoo Finance\",\"url\":\"https://finance.yahoo.com\"},{\"name\":\"Bloomberg Markets\",\"url\":\"https://bloomberg.com/markets\"},{\"name\":\"Reuters Markets\",\"url\":\"https://reuters.com/markets\"},{\"name\":\"TradingView\",\"url\":\"https://www.tradingview.com/markets/\"},{\"name\":\"Tadawul\",\"url\":\"https://www.saudiexchange.sa\"},{\"name\":\"DFM\",\"url\":\"https://www.dfm.ae\"}]}",
      900
    );
    res.json(parseJSON(text));
  } catch (e) {
    console.error("Commentary error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── MARKETS PRICES ────────────────────────────────────────────────────────────
app.get("/api/markets/quote", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "Symbols required" });

  for (const base of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(base + "/v8/finance/quote?symbols=" + encodeURIComponent(symbols), {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Referer": "https://finance.yahoo.com",
          "Origin": "https://finance.yahoo.com",
        },
      });
      if (!r.ok) throw new Error("Yahoo status: " + r.status);
      const d = await r.json();
      const quotes = (d?.quoteResponse?.result || [])
        .map(q => ({
          symbol: q.symbol,
          name: q.shortName || q.longName || q.symbol,
          price: q.regularMarketPrice,
          change: q.regularMarketChange,
          changePercent: q.regularMarketChangePercent,
          currency: q.currency || "USD",
        }))
        .filter(q => q.price != null);
      if (quotes.length > 0) return res.json({ quotes, source: "yahoo" });
    } catch (e) { console.warn("Yahoo failed:", e.message); }
  }

  const sl = symbols.split(",");
  const isMideast = sl.some(s => s.includes(".SR") || s.includes(".AE") || s === "^KWSE");
  const isAsia = sl.some(s => ["^N225","^HSI","^AXJO","000001.SS"].includes(s));
  const isEurope = sl.some(s => ["^FTSE","^GDAXI","^FCHI","^IBEX"].includes(s));
  const isCom = sl.some(s => ["CL=F","BZ=F","GC=F","SI=F","NG=F"].includes(s));
  const groupName = isMideast ? "Middle East stock indices (Tadawul, DFM, ADX, Kuwait)"
    : isAsia ? "Asian stock indices (Nikkei, Hang Seng, ASX, Shanghai)"
    : isEurope ? "European stock indices (FTSE, DAX, CAC, IBEX)"
    : isCom ? "commodities (WTI Oil, Brent Oil, Gold, Silver, Natural Gas)"
    : "US stock indices (S&P 500, Dow Jones, Nasdaq, Russell 2000)";

  try {
    const text = await callClaude(
      "Financial data assistant. Respond ONLY with a valid JSON object. No markdown or extra text.",
      "Realistic approximate current prices for " + groupName + ". Symbols: " + symbols + ".\n\nReturn JSON: {\"quotes\":[{\"symbol\":\"<symbol>\",\"name\":\"<full name>\",\"price\":<number>,\"change\":<number>,\"changePercent\":<number>}],\"source\":\"ai_estimate\"}",
      700
    );
    return res.json(parseJSON(text));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── ASK / Q&A with conversation history ──────────────────────────────────────
app.post("/api/ask", async (req, res) => {
  const { question, history } = req.body;
  if (!question) return res.status(400).json({ error: "Question required" });

  const messages = [];
  if (history && Array.isArray(history)) {
    for (const turn of history.slice(-6)) {
      if (turn.role && turn.content) messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: "user", content: question });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: "You are Briefly Intelligence, a senior global intelligence analyst. Today: " + todayStr() + ". Provide concise, factual, well-structured analysis. Be direct and informative.",
        messages,
      }),
    });
    if (!r.ok) { const t = await r.text(); throw new Error("API " + r.status + ": " + t.slice(0, 200)); }
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const text = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    res.json({ answer: text });
  } catch (e) {
    console.error("Ask error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString(), model: MODEL, version: VERSION }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Briefly Intelligence v" + VERSION + " running on port " + PORT));
