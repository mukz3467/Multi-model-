export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({
    error: "GEMINI_API_KEY is not configured.",
    setup: "Add GEMINI_API_KEY in your Vercel project Environment Variables."
  });

  try {
    const { prompt = "", mimeType = "", data = "" } = req.body || {};
    if (!prompt && !data) return res.status(400).json({ error: "Prompt or file data is required." });

    const parts = [];
    if (prompt) parts.push({ text: prompt });

    if (data) {
      parts.push({
        inline_data: {
          mime_type: mimeType || "application/octet-stream",
          data
        }
      });
    }

    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048
        }
      })
    });

    const json = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: json?.error?.message || "Gemini request failed."
      });
    }

    const text = json?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("")
      .trim() || "No text response returned.";

    return res.status(200).json({ text, model });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error." });
  }
}
