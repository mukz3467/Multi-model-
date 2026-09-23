export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({
    error: "GEMINI_API_KEY is not configured."
  });

  try {
    const { mimeType = "", data = "", instruction = "" } = req.body || {};
    if (!data) return res.status(400).json({ error: "Video data is required." });

    const prompt = `You are a professional AI post-production director.
Analyze this uploaded video and return ONLY valid JSON matching this schema:
{
  "project": {"format":"9:16","target_duration_seconds":0,"summary":""},
  "hook": {"strategy":"","reason":""},
  "cuts": [{"start":0,"end":0,"action":"keep|remove|tighten","reason":""}],
  "captions": [{"start":0,"end":0,"text":"","style":"dynamic"}],
  "overlays": [{"start":0,"end":0,"type":"text|broll|zoom|graphic","instruction":""}],
  "audio": [{"start":0,"end":0,"action":"keep|duck|remove|enhance","instruction":""}],
  "transitions": [{"at":0,"type":"","duration":0}],
  "export": {"aspect_ratio":"9:16","resolution":"1080x1920","fps":30}
}
Rules:
- Do not invent precise timestamps unless the media provides enough evidence.
- If timestamps cannot be determined reliably, use approximate values and mark the reason as approximate.
- Prioritize retention, clarity and preservation of important faces/products/on-screen text.
- Never claim that the video has already been rendered.
- User instruction: ${instruction || "Create the best professional short-form edit plan."}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            {text: prompt},
            {inline_data: {mime_type: mimeType || "video/mp4", data}}
          ]
        }],
        generationConfig: {temperature: 0.15, maxOutputTokens: 6000}
      })
    });

    const json = await response.json();
    if (!response.ok) return res.status(response.status).json({
      error: json?.error?.message || "Model request failed."
    });

    const raw = json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
    if (!raw) return res.status(502).json({error:"No edit plan returned."});

    const cleaned = raw.replace(/^\`\`\`json\s*/i,"").replace(/\s*\`\`\`$/,"").trim();

    let plan;
    try { plan = JSON.parse(cleaned); }
    catch { return res.status(502).json({error:"Model returned invalid JSON.", raw: cleaned}); }

    return res.status(200).json({plan, model:"gemini-2.5-flash"});
  } catch (error) {
    return res.status(500).json({error:error.message || "Server error."});
  }
}