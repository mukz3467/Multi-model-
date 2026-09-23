function num(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(v, min, max, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(Math.max(x, min), max) : fallback;
}

function cleanPlan(plan = {}) {
  const p = plan && typeof plan === "object" ? plan : {};
  p.project ||= {};
  p.hook ||= {};
  p.cuts = Array.isArray(p.cuts) ? p.cuts : [];
  p.captions = Array.isArray(p.captions) ? p.captions : [];
  p.overlays = Array.isArray(p.overlays) ? p.overlays : [];
  p.audio = Array.isArray(p.audio) ? p.audio : [];
  p.transitions = Array.isArray(p.transitions) ? p.transitions : [];
  p.broll = Array.isArray(p.broll) ? p.broll : [];
  p.scene_compositing ||= {};
  p.export ||= {};
  p.quality_checks ||= {};
  return p;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });

  try {
    const {
      mimeType = "",
      data = "",
      instruction = "",
      platform = "youtube",
      targetDuration = 30
    } = req.body || {};

    if (!data) return res.status(400).json({ error: "Video data is required." });

    const prompt = `You are the autonomous post-production director inside a professional multimodal media editor.

Analyze the uploaded video frame-by-frame and from its actual audio/transcript when available. Return ONLY valid JSON.

Schema:
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
    "brightness":0,
    "contrast":1,
    "saturation":1,
    "background_blur":0,
    "shadow_opacity":0.16
  },
  "broll": [
    {
      "at":0,
      "duration":0,
      "purpose":"",
      "search_query":"",
      "source_required":true,
      "asset_url":"",
      "asset_status":"not_supplied",
      "placement":"center",
      "mode":"inset|full"
    }
  ],
  "export": {
    "aspect_ratio":"9:16",
    "resolution":"1080x1920",
    "fps":30,
    "audio_codec":"aac"
  },
  "quality_checks": {
    "faces_preserved":true,
    "products_preserved":true,
    "onscreen_text_preserved":true,
    "timestamp_confidence":0
  }
}

Rules:
- Every decision must be grounded in the actual uploaded media.
- Never invent facts, dialogue, people, products, events, timestamps, metrics or external assets.
- B-roll may be recommended, but asset_url MUST remain empty unless an asset URL was explicitly supplied in the request.
- Do not fabricate stock footage URLs.
- If exact timing is uncertain, use approximate timing and lower confidence.
- Detect dead air, repeated material, weak openings, accidental pauses and redundant visuals only when supported.
- Preserve faces, products, logos and meaningful on-screen text.
- Do not claim that editing/rendering has already happened.
- Green-screen detection must rely on visible evidence.
- Scene compositing values must be conservative.
- Prefer a clean professional edit over excessive effects.
- Use B-roll only when it materially improves explanation, pacing or visual clarity.
- Keep B-roll short enough that it does not obscure the main speaker/product unnecessarily.
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
          temperature: 0.1,
          maxOutputTokens: 10000,
          responseMimeType: "application/json"
        }
      })
    });

    const json = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: json?.error?.message || "Model request failed."
      });
    }

    const raw = json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
    if (!raw) return res.status(502).json({ error: "No edit plan returned." });

    const cleaned = raw
      .replace(/^\`\`\`json\s*/i, "")
      .replace(/\s*\`\`\`$/, "")
      .trim();

    let plan;
    try {
      plan = cleanPlan(JSON.parse(cleaned));
    } catch {
      return res.status(502).json({
        error: "Model returned invalid JSON.",
        raw: cleaned
      });
    }

    // Enforce safety/contract rules server-side rather than trusting model output.
    plan.broll = plan.broll.slice(0, 12).map(x => ({
      ...x,
      at: Math.max(0, num(x.at)),
      duration: clamp(x.duration, 0.25, 15, 2),
      source_required: true,
      asset_url: typeof x.asset_url === "string" ? x.asset_url.trim() : "",
      asset_status: x.asset_url ? "supplied" : "not_supplied"
    }));

    plan.overlays = plan.overlays.slice(0, 50);
    plan.captions = plan.captions.slice(0, 80);
    plan.cuts = plan.cuts.slice(0, 30);
    plan.audio = plan.audio.slice(0, 30);

    return res.status(200).json({
      plan,
      model: "gemini-2.5-flash",
      asset_policy: "B-roll assets are only rendered when a real asset_url/source_url is supplied."
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error." });
  }
}
