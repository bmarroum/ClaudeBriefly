# ClaudeBriefly


Briefly Intelligence
Live site: https://bmarroum.github.io/ClaudeBriefly/
Backend API: https://claudebriefly.onrender.com
A real-time global intelligence dashboard that aggregates live news, AI-generated briefings, travel advisories, airspace status, and market data into a single interface. Built for analysts, travelers, and anyone who needs a fast, structured view of what's happening in the world.

Stack
LayerTechnologyFrontendPlain HTML/CSS/JS — hosted on GitHub PagesBackendNode.js + Express — hosted on Render (free tier)AIAnthropic Claude (claude-sonnet-4-20250514)NewsLive RSS feeds (Reuters, AP, BBC, Al Jazeera, UPI, CNN, NHK, AFP, Guardian + Google News RSS)MapsLeaflet.js + CartoDB Voyager tilesMarket DataYahoo Finance v8 API (with AI fallback)

Features
📰 News Tab

6 global region pills: Global, North America, Europe, Asia, Middle East & Africa, South America
Live RSS feeds per region from major international wire services
Headline search — search bar filters live headlines across all sources without leaving the tab
Sources include: AP, Reuters, BBC, Al Jazeera, UPI, CNN, NHK, The Guardian, AFP and more

📋 Intelligence Brief Tab

Search mode — find live headlines on any topic from all sources
Full Brief mode — generates a comprehensive, structured AI intelligence brief with sections for: Executive Summary, Geopolitical Analysis, Humanitarian Impact, Economic Impact, Social Dynamics, and Strategic Outlook
Sources grounded in: AP, Reuters, AFP, Al Jazeera, BBC, Bloomberg, NYT, Xinhua, Kyodo, PTI, Yonhap, AAP, Anadolu Agency, and major government sources
All generated briefs are auto-saved to the Archive

✈️ Airspace & NOTAMs Tab

12 countries including Ukraine, Russia, Israel, Jordan, Lebanon, UAE, Saudi Arabia, US, UK, France, Germany, China
AI-synthesized NOTAM summaries grounded in live aviation news
Interactive Leaflet map centered on selected country
Status levels: GREEN / AMBER / RED / BLACK (Conflict Zone)
Verification links to FAA, EUROCONTROL, EASA, and ICAO

🛡️ Travel Advisories Tab

12 countries covering the Middle East, Eastern Europe, and South Asia
Dual-source format: US State Department + UK FCDO per country
Backend fetches the actual advisory pages from travel.state.gov and gov.uk/foreign-travel-advice and feeds content to Claude
Each card has a direct Official Source → link to both embassy sites
US advisory levels: 1 (Normal) → 2 (Caution) → 3 (Reconsider) → 4 (Do Not Travel)

📈 Markets Tab

5 regional sections: US, Europe, Asia, Middle East, Commodities
Live price cards via Yahoo Finance API with AI fallback
Middle East symbols: Tadawul ^TASI.SR, DFM DFMGI.AE, ADX ^ADSMI.AE, Kuwait ^KWSE
AI market commentary with dedicated sections per region including a Middle East analysis
Sources: Bloomberg, Reuters, FT, CNBC, Tadawul, DFM

🗞️ Press Releases Tab

Official government statements organized by region (6 regions)
Card grid layout with color-coded category banners (Foreign Policy, Economy, Defense, Health, Environment, etc.)
Country flag, ministry name, and direct official source link per card

🗄️ Archive Tab

Every generated intelligence brief is automatically saved to localStorage
Persists across sessions (up to 50 briefs)
Click any archived brief to reload the full analysis

🤖 Ask Tab

Direct AI Q&A on any global event, country, or topic
Powered by the same intelligence briefing engine

⚙️ Settings Tab

Dark/Light mode toggle (persisted)
Auto-refresh toggle and interval picker (5/10/15/30/60 min)
Show/hide citations and AI badges
Default region selection
Clear cache / Reset all


Architecture
GitHub Pages (index.html)
        ↓  fetch()
Render Backend (server.js)
    ├── /api/news          → RSS feeds by region + Google News RSS + Claude fallback
    ├── /api/rss/breaking  → Multi-source ticker feed
    ├── /api/briefing      → Claude AI with live RSS context injection
    ├── /api/press-releases → Claude AI + live Google News context
    ├── /api/airspace      → Claude AI + live aviation news context
    ├── /api/advisories    → Live scrape of State Dept + FCDO + Claude summary
    ├── /api/markets/quote → Yahoo Finance v8 API + Claude fallback
    └── /api/markets/commentary → Claude AI market analysis

Version History
VersionDescriptionv2.0-stableMobile responsive, region-based news, headline search, expanded sources, advisory links, archive, press redesign, Middle East markets fixv1.0-stableInitial release — settings tab, dark mode, auto-refresh, breaking ticker, all core tabs

Deployment
Frontend — GitHub Pages, auto-deploys from main branch root (index.html).
Backend — Render free tier, auto-deploys from main branch (server.js). Set environment variable ANTHROPIC_API_KEY in Render dashboard.
Note: Render free tier has a ~30 second cold start after inactivity. The frontend retries automatically up to 3 times with 8-second delays.

Rollback
bash# Roll back to a stable tag
git checkout v1.0-stable -- index.html
git add index.html
git commit -m "rollback: restore v1.0-stable"
git push

# List all saved versions
git tag -l

Known Limitations

NOTAM data is AI-synthesized from live aviation news — not a direct NOTAM API feed. For operational aviation use, verify directly at FAA NOTAMs or EUROCONTROL.
Market prices use Yahoo Finance's unofficial v8 API. Middle East markets (^TASI.SR, DFMGI.AE) may not always be available outside trading hours.
Render cold start — first request after inactivity takes ~30 seconds.
All AI-generated content should be verified with official sources before operational use.

