const ALLOWED_HOSTS = new Set(["commons.wikimedia.org","upload.wikimedia.org"]);

function validRemoteUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname);
  } catch { return false; }
}

function cleanStyle(value) {
  return String(value || "professional studio").replace(/[\\r\\n]/g, " ").replace(/[^\\p{L}\\p{N}\\s,.'-]/gu, "").trim().slice(0, 180);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { prompt = "", has_green_screen = false, background_style = "professional studio", platform = "youtube", background_url = "" } = req.body || {};
    const vertical = platform !== "youtube";
    const style = cleanStyle(background_style);
    const safeBackgroundUrl = validRemoteUrl(background_url) ? background_url : "";
    const scenePlan = {
      module: "AI Scene Composer",
      goal: "Create an evidence-based, realistic green-screen compositing plan.",
      green_screen_detected: Boolean(has_green_screen),
      background_required: Boolean(has_green_screen),
      background_prompt: style + ", realistic professional environment, physically plausible perspective and lighting, natural depth, no people, no text, no logos",
      background_source: safeBackgroundUrl ? "approved_remote_asset" : "not_supplied",
      render_parameters: { key_color:"0x00ff00", similarity:0.12, blend:0.08, background_blur:2, shadow_opacity:0.16, preserve_identity:true, preserve_clothing:true, scale:1, position:{x:0.5,y:vertical?0.62:0.58}, brightness:0, contrast:1, saturation:1 },
      quality_gates: ["no green spill halo","preserve hair and fine edges","no floating subject","background perspective must be plausible","foreground/background exposure should be consistent","preserve identity, clothing and body proportions"],
      composite_notes: "Use subject-aware positioning. Adjust scale, x/y placement, exposure and color only from detected visual evidence; do not invent camera or lighting measurements."
    };
    if (safeBackgroundUrl) scenePlan.background_url = safeBackgroundUrl;
    return res.status(200).json({ scene_plan:scenePlan, request:String(prompt).slice(0,1000), evidence_based:true, background_policy:"A background is rendered only when a supplied HTTPS asset is from an approved media host." });
  } catch (error) { return res.status(500).json({ error:error.message || "Scene composition failed." }); }
}