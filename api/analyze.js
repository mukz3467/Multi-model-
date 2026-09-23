export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({
    error: "GEMINI_API_KEY is not configured.",
    setup: "Add GEMINI_API_KEY in your Vercel project Environment Variables."
  });

  try {
    const {
      prompt = "",
      mimeType = "",
      data = "",
      editing = false,
      seo = false,
      analysis = true
    } = req.body || {};

    if (!prompt && !data) {
      return res.status(400).json({ error: "Prompt or file data is required." });
    }

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

    const extra = [];
    if (analysis) extra.push(
      "Return structured analysis with: topic, hook, audience, scenes/content points, strengths, weaknesses and concrete improvements."
    );
    if (seo) extra.push(
      "Also return platform-specific SEO for YouTube, Instagram Reels, TikTok and Facebook Reels. Include title/caption, description, keywords and hashtags."
    );
    if (editing) extra.push(
      "Also create an AUTOMATIC EDIT PLAN. Identify the strongest moments, suggested cuts, pacing, caption moments, B-roll opportunities, music/sound cues, transitions, opening hook, ending CTA, and 9:16 export guidance. Do not claim that the file was physically edited; this is the machine-readable plan for a later FFmpeg/video-rendering worker."
    );

    const finalPrompt = [
      "You are the analysis engine of a multimodal AI video workspace.",
      ...extra,
      "Be factual and clearly distinguish observations from recommendations.",
      "Never invent timestamps when the uploaded media does not provide enough evidence.",
      prompt
    ].filter(Boolean).join("\n\n");

    parts[0] = { text: finalPrompt };

    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 4096
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

    return res.status(200).json({
      text,
      model,
      capabilities: {
        analysis,
        seo,
        editing_plan: editing
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error."
    });
  }
}
