export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });

  try {
    const { mimeType = "", data = "", instruction = "", platform = "youtube", targetDuration = 30 } = req.body || {};
    if (!data) return res.status(400).json({ error: "Video data is required." });

    const aspect = platform === "youtube" ? "9:16" : "9:16";
    const prompt = `You are an autonomous professional short-form post-production director.

Analyze the uploaded video and return ONLY valid JSON matching this schema:
{
  "project": {
    "format": "9:16",
    "target_duration_seconds": 30,
    "summary": "",
    "source_evidence": []
  },
  "hook": {
    "strategy": "",
    "reason": "",
    "start_seconds": 0,
    "end_seconds": 3
  },
  "cuts": [
    {"start":0,"end":0,"action":"keep|remove|tighten","reason":"","confidence":0}
  ],
  "captions": [
    {"start":0,"end":0,"text":"","style":"dynamic","position":"lower-third","confidence":0}
  ],
  "overlays": [
    {"start":0,"end":0,"type":"text|broll|zoom|graphic|highlight","instruction":"","asset_required":false}
  ],
  "audio": [
    {"start":0,"end":0,"action":"keep|duck|remove|enhance","instruction":""}
  ],
  "transitions": [
    {"at":0,"type":"cut|crossfade|zoom|none","duration":0.0}
  ],
  "scene_compositing": {
    "green_screen_detected": false,
    "background_required": false,
    "background_prompt": "",
    "scale": 1,
    "position": {"x":0.5,"y":0.62},
    "brightness": 0,
    "contrast": 1,
    "saturation": 1,
    "background_blur": 0,
    "shadow_opacity": 0.16
  },
  "broll": [
    {"at":0,"duration":0,"purpose":"","search_query":"","source_required":true}
  ],
  "export": {
    "aspect_ratio":"9:16",
    "resolution":"1080x1920",
    "fps":30,
    "audio_codec":"aac"
  },
  "quality_checks": {
    "faces_preserved": true,
    "products_preserved": true,
    "onscreen_text_preserved": true,
    "timestamp_confidence": 0
  }
}

Rules:
- Base every decision on visible/audible evidence from the uploaded media.
- Do not invent facts, dialogue, products, people, events, timestamps or performance metrics.
- If exact timestamps are uncertain, use approximate timestamps and lower confidence.
- Never claim that rendering or editing has already happened.
- Preserve faces, products, logos and important on-screen text unless the evidence indicates removal is appropriate.
- Detect dead air, repeated content, weak openings, accidental pauses and visually redundant sections when supported by the media.
- The first seconds should establish the video's actual topic without inventing a hook.
- B-roll entries are plans only; never pretend an external asset exists.
- Green-screen detection must be based on visible evidence.
- Scene compositing parameters must be conservative and evidence-based.
- Do not create fake engagement statistics.
- Target duration: ${Number(targetDuration) || 30} seconds.
- Platform: ${platform}.
- User instruction: ${instruction || "Create the most professional retention-focused edit plan supported by the source media."}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || "video/mp4", data } }
          ]
        }],
        generationConfig: {
          temperature: 0.12,
          maxOutputTokens: 9000,
          responseMimeType: "application/json"
        }
      })
    });

    const json = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: json?.error?.message || "Model request failed." });
    }

    const raw = json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
    if (!raw) return res.status(502).json({ error: "No edit plan returned." });

    const cleaned = raw.replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/, "").trim();
    let plan;
    try {
      plan = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: "Model returned invalid JSON.", raw: cleaned });
    }

    return res.status(200).json({ plan, model: "gemini-2.5-flash" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error." });
  }
}
