export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const {
    prompt = "",
    has_green_screen = false,
    background_style = "professional studio",
    platform = "youtube"
  } = req.body || {};

  const vertical = platform !== "youtube";
  const instructions = {
    module: "AI Scene Composer",
    goal: "Create an evidence-based, realistic green-screen compositing plan.",
    steps: [
      "detect green-screen quality and subject edges",
      "remove green spill while preserving hair and fine edges",
      "select or generate a background that matches the topic and camera framing",
      "match subject scale and perspective to the background",
      "match exposure, white balance, color temperature and contrast",
      "apply restrained depth-of-field to the background only",
      "create a subtle contact/grounding shadow when scene geometry supports it",
      "grade foreground and background together",
      "preserve identity, clothing, body proportions and facial details",
      "avoid wallpaper artifacts, halos, floating subjects and mismatched lighting"
    ],
    output: {
      background_prompt:
        `${background_style}, realistic professional environment, physically plausible perspective and lighting, natural depth, no people, no text, no logos`,
      export: vertical ? "9:16" : "16:9",
      render_parameters: {
        key_color: "0x00ff00",
        similarity: 0.12,
        blend: 0.08,
        background_blur: 2,
        shadow_opacity: 0.16,
        preserve_identity: true,
        preserve_clothing: true
      },
      composite_notes:
        "Use subject-aware positioning. Adjust scale, x/y placement, exposure and color only from detected visual evidence; do not invent camera or lighting measurements."
    }
  };

  return res.json({
    scene_plan: instructions,
    request: prompt,
    green_screen_detected: Boolean(has_green_screen),
    evidence_based: true
  });
}
