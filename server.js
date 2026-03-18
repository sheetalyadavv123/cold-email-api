const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://craftmail-ai.vercel.app"
  ]
}));
app.use(express.json());

app.use(morgan("dev"));

const log = {
  info: (msg, data = "") => console.log(`[${new Date().toISOString()}] ✦ INFO  ${msg}`, data),
  error: (msg, data = "") => console.error(`[${new Date().toISOString()}] ✦ ERROR ${msg}`, data),
  success: (msg, data = "") => console.log(`[${new Date().toISOString()}] ✦ OK    ${msg}`, data),
};


const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many requests. Please wait 15 minutes and try again." }
});

app.use("/api/generate-email", limiter);

// HEALTH CHECK
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Cold Email API is running on Groq 🚀" });
});

// GENERATE EMAIL
app.post("/api/generate-email", async (req, res) => {
  const {
    yourName, yourRole, company, targetRole,
    companyAbout, uniqueValue, tone, length,
  } = req.body;

  if (!company || !targetRole) {
  log.error("Missing required fields", { company, targetRole });
  return res.status(400).json({ error: "Company and Target Role are required." });
  }

log.info(`Generating email`, `${targetRole} @ ${company} | tone: ${tone}`);


  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY not configured in .env" });
  }

  const prompt = `
You are an elite career strategist and copywriter. Write a cold email for a job application.

Sender: ${yourName || "the applicant"}, applying for ${targetRole} at ${company}.
Their background/role: ${yourRole || "a developer"}.
What makes them unique: ${uniqueValue || "strong technical skills and passion for the role"}.
About the company: ${companyAbout || "a leading company in its space"}.
Tone: ${tone || "Professional"}.
Length: ${length || "Medium (250 words)"}.

Format your response EXACTLY like this:
Subject: [compelling subject line]

[email body — no markdown, no asterisks, plain text only, naturally structured paragraphs]

Make it feel human, specific, and compelling. Avoid clichés. Reference the company genuinely.
`.trim();

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:"llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
        temperature: 0.8,
        stream: true,
      }),
    });

    if (!groqRes.ok) {
       const errText = await groqRes.text();
       log.error(`Groq API failed`, `status: ${groqRes.status} | ${errText}`);
       return res.status(500).json({ error: errText });
    }     

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Stream Groq response → client
    const reader = groqRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.delta?.content || "";
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        } catch {}
      }
    }

    res.write("data: [DONE]\n\n");
    log.success(`Email generated`, `${targetRole} @ ${company}`);
    res.end();        

  } catch (err) {
  log.error("Server error", err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: "Something went wrong: " + err.message });
  }
}
});

app.listen(PORT, () => {
  console.log(`\n✦ Cold Email API running at http://localhost:${PORT}`);
  console.log(`✦ Using Groq — llama-3.3-70b-versatile`);
  console.log(`✦ Health check: http://localhost:${PORT}/\n`);
});