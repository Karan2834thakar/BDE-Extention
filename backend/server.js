const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

const SYSTEM_PROMPT = `
You are a technical sales assistant helping a non-technical Business Development Executive.

Your job is to:
- Explain answers in SIMPLE language
- Keep answers short and clear
- Avoid deep technical jargon
- Make the user sound confident

Always respond in this format:

Short Answer:
<1-2 lines>

Explanation:
<simple explanation>

Example:
<real-world analogy if possible>
`.trim();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: MODEL });

app.use(cors());
app.use(express.json());

app.post("/ask", async (req, res) => {
  try {
    const question = (req.body?.question || "").trim();

    if (!question) {
      return res.status(400).json({ error: "Question is required." });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });
    }

    const prompt = `${SYSTEM_PROMPT}\n\nUser Question:\n${question}`;
    const result = await model.generateContent(prompt);
    const answer =
      result?.response?.text()?.trim() ||
      "I could not generate a response right now.";

    return res.json({ answer });
  } catch (error) {
    console.error("Gemini /ask error:", error);
    return res.status(500).json({
      error: "Failed to generate answer.",
      answer: "Sorry, I hit a temporary issue. Please try again in a moment."
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bde-ai-copilot-backend" });
});

app.listen(PORT, () => {
  console.log(`BDE AI Copilot backend running on http://localhost:${PORT}`);
});
