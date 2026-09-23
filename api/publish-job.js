export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { platform, media_url, caption, scheduled_at, approval = true } = req.body || {};
  if (!platform || !media_url) {
    return res.status(400).json({ error: "platform and media_url are required." });
  }

  // This endpoint intentionally creates a platform-neutral job.
  // Real publishing requires the user's authenticated platform API connection.
  const job = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    platform,
    media_url,
    caption: caption || "",
    scheduled_at: scheduled_at || null,
    status: approval ? "ready_for_platform_connector" : "awaiting_approval",
    created_at: new Date().toISOString(),
    requires: [
      "authenticated platform connector",
      "platform-specific media/caption validation"
    ]
  };

  res.status(202).json({
    job,
    message: "Publish job prepared. No platform post was claimed without an authenticated connector."
  });
}
