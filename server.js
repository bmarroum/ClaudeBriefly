const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/briefing", async (req, res) => {
  const { topic } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: `You are a senior intelligence analyst writing for a high-level briefing platform called Briefly Intelligence. Write a concise, authoritative 3-paragraph intelligence analysis on: "${topic}".

Paragraph 1: Current situation assessment (factual, measured tone)
Paragraph 2: Key drivers and forces at play  
Paragraph 3: Forward-looking signals and strategic implications

Write in the style of a Council on Foreign Relations analyst. Be specific, insightful, and avoid generic statements. Pure analytical prose only — no headers, no bullet points.`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const text = data.content?.[0]?.text || "Analysis unavailable.";
    res.json({ analysis: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate briefing." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
