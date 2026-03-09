const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

// Gzip compress all responses
const zlib = require('zlib');
app.use((req, res, next) => {
  const ae = req.headers['accept-encoding'] || '';
  if (!ae.includes('gzip')) return next();
  const _json = res.json.bind(res);
  res.json = (data) => {
    const buf = Buffer.from(JSON.stringify(data));
    zlib.gzip(buf, (err, compressed) => {
      if (err) return _json(data);
      res.set({ 'Content-Encoding': 'gzip', 'Content-Type': 'application/json', 'Vary': 'Accept-Encoding' });
      res.send(compressed);
    });
  };
  next();
});
app.use(express.json());

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-20250514";
const GEMINI_MODEL = "gemini-2.0-flash";

// ── IN-MEMORY BRIEF CACHE (topic → result, 15min TTL) ────────────────────────
const BRIEF_CACHE = new Map();
const BRIEF_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getBriefCache(topic) {
  const key = topic.trim().toLowerCase();
  const entry = BRIEF_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > BRIEF_CACHE_TTL) { BRIEF_CACHE.delete(key); return null; }
  return entry.data;
}

function setBriefCache(topic, data) {
  const key = topic.trim().toLowerCase();
  BRIEF_CACHE.set(key, { data, ts: Date.now() });
  // Keep cache from growing unbounded
  if (BRIEF_CACHE.size > 50) {
    const oldest = [...BRIEF_CACHE.entries()].sort((a,b) => a[1].ts - b[1].ts)[0][0];
    BRIEF_CACHE.delete(oldest);
  }
}

// ── CACHE HELPER ──────────────────────────────────────────────────────────────
function setCache(res, seconds) {
  res.set({
    'Cache-Control': `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`,
    'Vary': 'Accept-Encoding',
  });
}
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "llama-3.3-70b-versatile";
const VERSION = "4.5";

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


// ── GROQ HELPER ───────────────────────────────────────────────────────────────
async function callGroq(systemPrompt, messages, maxTokens = 800) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");
  const body = {
    model: GROQ_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages
    ]
  };
  const r = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text(); throw new Error("Groq " + r.status + ": " + t.slice(0, 200)); }
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.choices[0].message.content;
}


// ── GEMINI HELPER (2-step: search first, then structured analysis) ────────────
async function callGemini(topic, jsonSchema) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const geminiPost = async (body) => {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + apiKey,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!r.ok) {
      const t = await r.text();
      throw new Error("Gemini API " + r.status + ": " + t.slice(0, 300));
    }
    return r.json();
  };

  // ── STEP 1: Grounded search — let Gemini search freely, return a prose summary ──
  const searchBody = {
    contents: [{
      parts: [{ text:
        "Search for the very latest news and developments about: \"" + topic + "\"\n" +
        "Today is " + todayStr() + ". Focus on events from the past 2 weeks.\n" +
        "Return a detailed factual summary of what you find: key events, key people involved, " +
        "current status, recent developments, and any significant changes. Be specific with dates and facts."
      }]
    }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 1500, temperature: 0.1 },
  };

  let groundedSummary = "";
  let groundingSources = [];

  const d1 = await geminiPost(searchBody);
  groundedSummary = d1.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  const groundingChunks = d1.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  groundingSources = groundingChunks.slice(0, 8).map(c => ({
    name: c.web?.title || "Web Source",
    url: c.web?.uri || "#"
  }));
  const searchUsed = groundingChunks.length > 0;

  if (!groundedSummary.trim()) throw new Error("Gemini search returned no content");

  // ── STEP 2: Structure the grounded content into JSON — NO search tool this time ──
  const structureBody = {
    contents: [{
      parts: [{ text:
        "You are a senior intelligence analyst. Today is " + todayStr() + ".\n\n" +
        "Based ONLY on the following verified, current intelligence gathered from live sources, " +
        "write a structured intelligence brief. Do NOT use your training data — use ONLY what is below.\n\n" +
        "=== LIVE INTELLIGENCE ===\n" + groundedSummary + "\n=== END ===\n\n" +
        "Now respond with ONLY a valid JSON object using this exact structure. " +
        "No markdown fences, no preamble, no text outside the JSON:\n" + jsonSchema
      }]
    }],
    generationConfig: { maxOutputTokens: 3000, temperature: 0.2 },
  };

  const d2 = await geminiPost(structureBody);
  const text = d2.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  if (!text.trim()) throw new Error("Gemini structuring returned no content");

  return { text, sources: groundingSources, searchUsed, groundedSummary };
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
// ── MULTI-ENGINE HELPERS ───────────────────────────────────────────────────────

// Run Claude + Groq in parallel, return first successful result
async function raceAI(systemPrompt, userPrompt, maxTokens = 800) {
  const attempts = [];
  if (process.env.ANTHROPIC_API_KEY) {
    attempts.push(
      callClaude(systemPrompt, userPrompt, maxTokens)
        .then(text => ({ text, engine: 'claude' }))
        .catch(e => { console.warn('raceAI Claude failed:', e.message); return null; })
    );
  }
  if (process.env.GROQ_API_KEY) {
    attempts.push(
      callGroq(systemPrompt, [{ role: 'user', content: userPrompt }], maxTokens)
        .then(text => ({ text, engine: 'groq' }))
        .catch(e => { console.warn('raceAI Groq failed:', e.message); return null; })
    );
  }
  if (!attempts.length) throw new Error('No AI engines configured');
  // Return first non-null result
  const results = await Promise.all(attempts);
  const winner = results.find(r => r && r.text && r.text.trim().length > 20);
  if (!winner) throw new Error('All AI engines failed');
  return winner;
}

// Run all three engines in parallel and collect all results (for briefing)
async function parallelAI(systemPrompt, userPrompt, maxTokens = 1024) {
  const tasks = [];
  if (process.env.ANTHROPIC_API_KEY) {
    tasks.push(
      callClaude(systemPrompt, userPrompt, maxTokens)
        .then(text => ({ text, engine: 'claude' }))
        .catch(e => { console.warn('parallelAI Claude:', e.message); return null; })
    );
  }
  if (process.env.GEMINI_API_KEY) {
    tasks.push(
      callGeminiSimple(userPrompt, maxTokens)
        .then(text => ({ text, engine: 'gemini' }))
        .catch(e => { console.warn('parallelAI Gemini:', e.message); return null; })
    );
  }
  if (process.env.GROQ_API_KEY) {
    tasks.push(
      callGroq(systemPrompt, [{ role: 'user', content: userPrompt }], maxTokens)
        .then(text => ({ text, engine: 'groq' }))
        .catch(e => { console.warn('parallelAI Groq:', e.message); return null; })
    );
  }
  const results = await Promise.all(tasks);
  return results.filter(r => r && r.text && r.text.trim().length > 20);
}

// Simple Gemini text call (no grounding, just completion)
async function callGeminiSimple(prompt, maxTokens = 800) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 }
      })
    }
  );
  if (!r.ok) throw new Error('Gemini ' + r.status);
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini empty response');
  return text;
}


app.post("/api/news", async (req, res) => {
  setCache(res, 300); // 5 min
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

// ── OG IMAGE SCRAPER ─────────────────────────────────────────────────────────
// Fetches Open Graph / Twitter Card image from an article URL (server-side to avoid CORS)
app.get("/api/og-image", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });

  // Only allow http/https URLs
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "invalid url" });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BrieflyBot/3.0; +https://bmarroum.github.io/ClaudeBriefly/)",
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
    });
    clearTimeout(timer);
    if (!r.ok) return res.json({ image: null });

    // Read only the <head> — stop after </head> to avoid downloading entire page
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) html += decoder.decode(value, { stream: true });
      if (html.includes("</head>") || html.length > 30000) break;
    }
    reader.cancel();

    // Extract OG/Twitter image
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
                 || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

    const image = ogMatch ? ogMatch[1] : null;

    // Only return http/https image URLs
    if (image && /^https?:\/\//i.test(image)) {
      res.setHeader("Cache-Control", "public, max-age=86400"); // cache 24h
      return res.json({ image });
    }
    return res.json({ image: null });
  } catch (e) {
    return res.json({ image: null }); // silent fail — images are non-critical
  }
});

// ── BREAKING TICKER ───────────────────────────────────────────────────────────
app.get("/api/rss/breaking", async (req, res) => {
  setCache(res, 120); // 2 min
  const items = [];
  for (const feed of BREAKING_FEEDS) {
    try {
      const rssItems = await fetchRSS(feed.url, 5000);
      rssItems.slice(0, 2).forEach(item => items.push({ ...item, source: feed.source }));
    } catch (e) { /* silent */ }
  }
  res.json({ items: items.slice(0, 18) });
});

// ── INTELLIGENCE BRIEFING ────────────────────────────────────────────────────
// Data pipeline (in order of reliability):
//   1. Claude web_search tool — Anthropic-native, always works, reputable sources
//   2. Gemini + Google Search grounding — live web, parallel
//   3. Google News RSS — headline titles, parallel
// All three feed into a final Claude synthesis pass.

app.post("/api/briefing", async (req, res) => {
  const { topic, force } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic required" });

  // Serve from cache if available (and not a forced refresh)
  if (!force) {
    const cached = getBriefCache(topic);
    if (cached) {
      console.log(`[BRIEF] Cache hit: "${topic}"`);
      return res.json({ ...cached, cached: true });
    }
  }

  const su = encodeURIComponent(topic);
  const hasGemini = !!process.env.GEMINI_API_KEY;

  // ── STEP 1: Parallel live intelligence gathering ─────────────────────────
  const hasGroq = !!process.env.GROQ_API_KEY;
  const [claudeSearchResult, geminiResult, rssResult, groqResult] = await Promise.allSettled([
    callClaudeSearch(topic),
    hasGemini ? callGemini(topic, null) : Promise.reject("No Gemini key"),
    fetchLiveRSS(topic),
    hasGroq ? callGroq(
      "You are an intelligence analyst. Today: " + todayStr() + ". Provide factual, concise analysis.",
      [{ role: "user", content: "Summarize the latest developments, key actors, and significance of: " + topic }],
      600
    ) : Promise.reject("No Groq key"),
  ]);

  const claudeSearchData = claudeSearchResult.status === "fulfilled" ? claudeSearchResult.value : null;
  const geminiData       = geminiResult.status       === "fulfilled" ? geminiResult.value       : null;
  const groqBriefData    = groqResult?.status         === "fulfilled" ? groqResult.value         : null;
  const rssData          = rssResult.status          === "fulfilled" ? rssResult.value          : null;
  const groqContextText  = groqResult?.status        === "fulfilled" ? groqResult.value         : null;

  // ── STEP 2: Build combined intelligence dossier ──────────────────────────
  let combinedContext = "=== LIVE INTELLIGENCE DOSSIER — " + todayStr() + " ===\n";
  combinedContext += "Topic: " + topic + "\n\n";

  let liveHeadlines = [];
  let geminiSources = [];
  let searchUsed = false;
  let dataSourceCount = 0;

  // Priority 1: Claude web search (most reliable — Anthropic-native)
  if (claudeSearchData && claudeSearchData.summary) {
    combinedContext += "--- SOURCE 1: WEB SEARCH (Claude, live web results) ---\n";
    combinedContext += claudeSearchData.summary + "\n\n";
    searchUsed = true;
    dataSourceCount++;
  }

  // Priority 2: Gemini Google Search grounding
  if (geminiData && geminiData.groundedSummary) {
    combinedContext += "--- SOURCE 2: GEMINI LIVE WEB SEARCH (Google-grounded) ---\n";
    combinedContext += geminiData.groundedSummary + "\n\n";
    geminiSources = geminiData.sources || [];
    searchUsed = true;
    dataSourceCount++;
  }
  if (groqContextText && typeof groqContextText === "string" && groqContextText.length > 50) {
    combinedContext += "--- SOURCE 3: GROQ/LLAMA INTELLIGENCE (Llama 3.3 70B) ---\n";
    combinedContext += groqContextText + "\n\n";
    dataSourceCount++;
  }

  // Priority 3: RSS news feed
  if (rssData && rssData.headlines && rssData.headlines.length) {
    liveHeadlines = rssData.headlines;
    combinedContext += "--- SOURCE 3: RSS NEWS FEED (recent headlines) ---\n";
    combinedContext += rssData.headlines.map((i, idx) =>
      (idx + 1) + ". [" +
      (i.pubDate ? new Date(i.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Recent") +
      "] " + i.title + (i.body ? " — " + i.body.slice(0, 250) : "")
    ).join("\n") + "\n\n";
    dataSourceCount++;
  }

  combinedContext += "=== END OF LIVE INTELLIGENCE (" + dataSourceCount + " source(s) retrieved) ===\n";

  // ── STEP 3: Build strict prompt based on data availability ──────────────
  const hasLiveData = dataSourceCount > 0;

  // Anti-hallucination rules scale with data availability
  const dataRules = hasLiveData
    ? "You have " + dataSourceCount + " live source(s) above. " +
      "Base ALL specific facts, dates, names, and events ONLY on what appears in those sources. " +
      "If the sources do not mention a specific detail, write \"[not confirmed in live sources]\" rather than inventing it. " +
      "For the timeline, only include events explicitly mentioned in the live sources with their actual dates."
    : "WARNING: No live data was retrieved. " +
      "DO NOT fabricate specific dates, events, or claim things happened. " +
      "Write in general terms about known background context only. " +
      "Set confidence to 20 or lower. " +
      "Explicitly state in the executive and situation fields that live data was unavailable and information is based on background knowledge only.";

  const JSON_SCHEMA =
    "{" +
    "\"classification\":\"INTELLIGENCE BRIEF\"," +
    "\"threat_level\":\"<CRITICAL|HIGH|ELEVATED|MODERATE|LOW>\"," +
    "\"threat_level_reason\":\"<one sentence — cite your source if possible>\"," +
    "\"confidence\":<integer 1-100 — lower if based on training data only>," +
    "\"data_sources\":<integer — number of live sources used>," +
    "\"executive\":\"<4-5 sentences — if no live data, say so explicitly>\"," +
    "\"situation\":\"<3-4 sentences — ONLY confirmed developments, note any uncertainty>\"," +
    "\"geopolitical\":\"<3-4 sentences on key actors and dynamics>\"," +
    "\"key_actors\":[{\"name\":\"<full real name>\",\"role\":\"<verified role>\",\"stance\":\"<confirmed position or [unconfirmed]>\"}]," +
    "\"humanitarian\":\"<2-3 sentences on confirmed humanitarian situation>\"," +
    "\"economic\":\"<2-3 sentences on economic impact>\"," +
    "\"strategic\":\"<3-4 sentences on outlook and risks>\"," +
    "\"timeline\":[{\"date\":\"<real confirmed date from sources>\",\"event\":\"<confirmed event — do not invent>\"}]," +
    "\"key_risks\":[\"<specific, grounded risk>\"]," +
    "\"watch_points\":[\"<specific indicator to watch>\"]," +
    "\"related_topics\":[\"<related geopolitical topic>\"]," +
    "\"sources\":[{\"name\":\"Reuters\",\"url\":\"https://reuters.com/search/news?blob=" + su + "\"},{\"name\":\"AP News\",\"url\":\"https://apnews.com/search?q=" + su + "\"},{\"name\":\"BBC\",\"url\":\"https://bbc.com/search?q=" + su + "\"},{\"name\":\"Bloomberg\",\"url\":\"https://bloomberg.com/search?query=" + su + "\"},{\"name\":\"Al Jazeera\",\"url\":\"https://aljazeera.com/search?q=" + su + "\"}}]" +
    "}";

  // ── STEP 4: Claude synthesises into final structured brief ───────────────
  try {
    const text = await callClaude(
      "You are a senior intelligence analyst producing a verified, sourced briefing. Today: " + todayStr() + ".\n\n" +
      "STRICT ACCURACY RULES:\n" +
      "1. Respond ONLY with a valid JSON object. No markdown, no preamble.\n" +
      "2. " + dataRules + "\n" +
      "3. Never invent dates, names, or events not present in your sources.\n" +
      "4. If a field cannot be answered from live sources, say so explicitly — do not fill with plausible-sounding content.\n" +
      "5. Confidence score must honestly reflect how much live data you have.",
      combinedContext +
      "\nWrite a verified intelligence brief about: " + topic +
      "\n\nOutput ONLY this JSON (every field must contain honest, sourced content):\n" + JSON_SCHEMA,
      2000
    );

    const analysis = parseJSON(text);

    // Attach real Gemini grounding sources
    if (geminiSources.length > 0) {
      analysis.sources = [...geminiSources, ...(analysis.sources || [])].slice(0, 10);
    }

    // Attach Claude search citations if available
    if (claudeSearchData && claudeSearchData.citations && claudeSearchData.citations.length > 0) {
      const citationSources = claudeSearchData.citations.slice(0, 5).map(c => ({
        name: c.title || c.url?.replace(/https?:\/\/(www\.)?/, "").split("/")[0],
        url: c.url
      }));
      analysis.sources = [...citationSources, ...(analysis.sources || [])].slice(0, 10);
    }

    analysis.data_sources = dataSourceCount;
    const engines = ["claude"];
    if (searchUsed) engines.push("gemini");
    if (groqContextText) engines.push("groq");
    const engineUsed = engines.join("+");
    const result = { analysis, liveHeadlines, engine: engineUsed, searchUsed, dataSourceCount };
    setBriefCache(topic, result);
    res.json(result);
  } catch (e) {
    console.error("Briefing synthesis error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Claude web_search tool — uses Anthropic's native search capability ────────
async function callClaudeSearch(topic) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": "web-search-2025-03-05",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: "You are a research assistant. Search the web for the latest news and information about the given topic. Focus on results from the past 2 weeks. Summarise what you find factually and include specific dates, names, and events. Return only what you found — no analysis, no opinions.",
      messages: [{ role: "user", content: "Search for the very latest news and developments about: \"" + topic + "\". Today is " + todayStr() + ". Find recent events, current status, key developments from the past 2 weeks. Be specific about dates and facts." }],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("Claude search API " + r.status + ": " + t.slice(0, 200));
  }
  const d = await r.json();

  // Extract text and any search result citations
  const blocks = d.content || [];
  const summary = blocks.filter(b => b.type === "text").map(b => b.text).join("\n");

  // Extract cited URLs from tool results
  const citations = [];
  blocks.filter(b => b.type === "tool_result" || b.type === "web_search_tool_result").forEach(b => {
    if (b.content) {
      (Array.isArray(b.content) ? b.content : [b.content]).forEach(c => {
        if (c.type === "document" && c.source) {
          citations.push({ title: c.title, url: c.source.url });
        }
      });
    }
  });

  if (!summary.trim()) throw new Error("Claude search returned empty");
  return { summary, citations };
}

// ── RSS helper for briefing live context ─────────────────────────────────────
async function fetchLiveRSS(topic) {
  const urls = [
    "https://news.google.com/rss/search?q=" + encodeURIComponent(topic) + "&hl=en-US&gl=US&ceid=US:en&tbs=qdr:w",
    "https://news.google.com/rss/search?q=" + encodeURIComponent(topic) + "&hl=en-US&gl=US&ceid=US:en",
  ];
  for (const url of urls) {
    try {
      const items = await fetchRSS(url, 5000);
      if (items.length > 0) return { headlines: items.slice(0, 10) };
    } catch (e) { /* try next */ }
  }
  return { headlines: [] };
}

// ── PRESS RELEASES ────────────────────────────────────────────────────────────
app.post("/api/press-releases", async (req, res) => {
  setCache(res, 900); // 15 min
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
      liveContext + "List 5-6 recent official government press releases and statements from the " + region + " region.\n\nRespond with this exact JSON:\n{\"region\":\"" + region + "\",\"date\":\"" + todayStr() + "\",\"releases\":[{\"title\":\"<title>\",\"country\":\"<country>\",\"ministry\":\"<ministry>\",\"summary\":\"<2-3 sentence summary>\",\"category\":\"<Foreign Policy|Economy|Defense|Health|Environment|Social|Infrastructure|Justice>\",\"source\":\"<source name>\",\"sourceUrl\":\"<https://official.gov.url>\",\"flag\":\"<emoji flag>\",\"date\":\"<YYYY-MM-DD>\",\"publishedTime\":\"<HH:MM UTC>\"}]}",
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
  setCache(res, 900); // 15 min
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
    const { text, engine: aiEngine } = await raceAI(
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
  setCache(res, 1800); // 30 min
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: "Country required" });

  const slug = country.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "");
  const usUrl = "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/" + slug + ".html";
  const usEmbassySearch = "https://www.google.com/search?q=US+embassy+" + encodeURIComponent(country) + "+site:travel.state.gov";
  const ukUrl = "https://www.gov.uk/foreign-travel-advice/" + slug;
  const ukEmbassySearch = "https://www.google.com/search?q=UK+embassy+" + encodeURIComponent(country) + "+site:gov.uk";

  try {
    const { text, engine: aiEngine } = await raceAI(
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
    const { text, engine: aiEngine } = await raceAI(
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
// ── TWELVE DATA symbol map (Yahoo symbols → Twelve Data format) ──────────────
const TD_SYMBOL_MAP = {
  "^GSPC": "SPX", "^DJI": "DJI", "^IXIC": "IXIC", "^RUT": "RUT",
  "^FTSE": "FTSE", "^GDAXI": "DAX", "^FCHI": "CAC40", "^IBEX": "IBEX35",
  "^N225": "N225", "^HSI": "HSI", "^AXJO": "AS51", "000001.SS": "SHCOMP",
  "^TASI": "TASI", "^DFMGI": "DFMGI", "^KWSE": "KWSE",
  "GC=F": "XAU/USD", "SI=F": "XAG/USD", "CL=F": "WTI", "BZ=F": "BRENT", "NG=F": "NG",
  "BTC-USD": "BTC/USD", "ETH-USD": "ETH/USD",
  "EURUSD=X": "EUR/USD", "GBPUSD=X": "GBP/USD", "JPY=X": "USD/JPY",
};

app.get("/api/markets/quote", async (req, res) => {
  setCache(res, 300); // 5 min
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "Symbols required" });
  const symList = symbols.split(",");

  // ── SOURCE 1: Twelve Data (real live prices) ─────────────────────────────
  const tdKey = process.env.TWELVE_DATA_API_KEY;
  if (tdKey) {
    try {
      // Map symbols to Twelve Data format
      const tdSymbols = symList.map(s => TD_SYMBOL_MAP[s] || s.replace("^","").replace("=X","").replace("-USD","/USD"));
      const tdQuery = tdSymbols.join(",");
      const tdUrl = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tdQuery)}&apikey=${tdKey}`;
      const tdR = await fetch(tdUrl, { signal: AbortSignal.timeout(8000) });
      if (tdR.ok) {
        const tdData = await tdR.json();
        // Also fetch previous close for change calculation
        const tdPrevUrl = `https://api.twelvedata.com/eod?symbol=${encodeURIComponent(tdQuery)}&apikey=${tdKey}`;
        const tdPrevR = await fetch(tdPrevUrl, { signal: AbortSignal.timeout(8000) });
        const tdPrev = tdPrevR.ok ? await tdPrevR.json() : {};

        const quotes = symList.map((origSym, i) => {
          const tdSym = tdSymbols[i];
          const entry = tdSymbols.length === 1 ? tdData : (tdData[tdSym] || tdData[origSym]);
          const prevEntry = tdSymbols.length === 1 ? tdPrev : (tdPrev[tdSym] || tdPrev[origSym]);
          if (!entry || entry.code === 400 || !entry.price) return null;
          const price = parseFloat(entry.price);
          const prevClose = prevEntry?.close ? parseFloat(prevEntry.close) : null;
          const change = prevClose ? price - prevClose : 0;
          const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
          return {
            symbol: origSym,
            name: origSym.replace("^","").replace("=X","").replace("-USD",""),
            price,
            change: parseFloat(change.toFixed(4)),
            changePercent: parseFloat(changePercent.toFixed(4)),
            currency: origSym.includes("=X") ? "FX" : "USD",
            source: "twelvedata"
          };
        }).filter(q => q && q.price);

        if (quotes.length > 0) {
          console.log(`Twelve Data: ${quotes.length}/${symList.length} quotes`);
          return res.json({ quotes, source: "twelvedata" });
        }
      }
    } catch (e) { console.warn("Twelve Data failed:", e.message); }
  }

  // ── SOURCE 2: Yahoo Finance (fallback) ───────────────────────────────────
  for (const base of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(base + "/v8/finance/quote?symbols=" + encodeURIComponent(symbols), {
        signal: AbortSignal.timeout(5000),
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
// ── MARKETS SPARKLINE (real price history from Twelve Data) ──────────────────
app.get("/api/markets/sparkline", async (req, res) => {
  setCache(res, 600); // 10 min
  const { symbol, interval = "1day", outputsize = "30" } = req.query;
  if (!symbol) return res.status(400).json({ error: "Symbol required" });

  const tdKey = process.env.TWELVE_DATA_API_KEY;
  if (!tdKey) return res.status(503).json({ error: "Twelve Data not configured" });

  const tdSym = TD_SYMBOL_MAP[symbol] || symbol.replace("^","").replace("=X","").replace("-USD","/USD");

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSym)}&interval=${interval}&outputsize=${outputsize}&apikey=${tdKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("Twelve Data " + r.status);
    const d = await r.json();
    if (!d.values || d.status === "error") throw new Error(d.message || "No data");
    const prices = d.values.map(v => parseFloat(v.close)).reverse();
    return res.json({ symbol, prices, source: "twelvedata" });
  } catch (e) {
    console.warn("Sparkline error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});


app.post("/api/ask", async (req, res) => {
  const { question, history, engine } = req.body;
  if (!question) return res.status(400).json({ error: "Question required" });

  const messages = [];
  if (history && Array.isArray(history)) {
    for (const turn of history.slice(-8)) {
      if (turn.role && turn.content) messages.push({ role: turn.role, content: turn.content });
    }
  }
  messages.push({ role: "user", content: question });

  const systemPrompt = "You are Briefly Intelligence, a senior global intelligence analyst. Today: " + todayStr() + ". Provide concise, factual, well-structured analysis. Use markdown: **bold** for key terms, ## for section headers when needed, bullet points for lists. Be direct and informative.";

  // Try Claude first (unless groq explicitly requested), fall back to Groq
  const preferGroq = engine === "groq" || !process.env.ANTHROPIC_API_KEY;
  const preferClaude = !preferGroq;

  if (preferClaude) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 800, system: systemPrompt, messages }),
      });
      if (!r.ok) throw new Error("Claude " + r.status);
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      const text = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      return res.json({ answer: text, engine: "claude" });
    } catch (claudeErr) {
      console.warn("Claude Ask failed, falling back to Groq:", claudeErr.message);
    }
  }

  // Groq + Gemini fallback (or primary if requested)
  const fallbackTasks = [];
  if (process.env.GROQ_API_KEY) {
    fallbackTasks.push(
      callGroq(systemPrompt, messages, 800)
        .then(text => ({ text, engine: "groq" }))
        .catch(() => null)
    );
  }
  if (process.env.GEMINI_API_KEY) {
    const geminiPrompt = systemPrompt + "\n\nUser question: " + question;
    fallbackTasks.push(
      callGeminiSimple(geminiPrompt, 800)
        .then(text => ({ text, engine: "gemini" }))
        .catch(() => null)
    );
  }
  try {
    const fallbackResults = await Promise.all(fallbackTasks);
    const winner = fallbackResults.find(r => r && r.text && r.text.trim().length > 20);
    if (winner) return res.json({ answer: winner.text, engine: winner.engine });
    const text = "All AI engines are currently unavailable. Please try again.";
    return res.json({ answer: text, engine: "none" });
  } catch (fallbackErr) {
    console.error("All engines failed:", fallbackErr.message);
    res.status(500).json({ error: "All AI engines unavailable" });
  }
});

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString(), model: MODEL, version: VERSION, gemini: !!process.env.GEMINI_API_KEY }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Briefly Intelligence v" + VERSION + " running on port " + PORT));
