export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { platform, account_id, posts = [], audience_activity = null } = req.body || {};
  if (!platform || !account_id) {
    return res.status(400).json({ error: "platform and account_id are required." });
  }

  const normalized = Array.isArray(posts) ? posts.map(p => ({
    id: p.id ?? null,
    published_at: p.published_at ?? null,
    published_hour: p.published_hour ?? null,
    topic: p.topic ?? null,
    format: p.format ?? null,
    views: Number(p.views ?? 0),
    reach: Number(p.reach ?? 0),
    likes: Number(p.likes ?? 0),
    comments: Number(p.comments ?? 0),
    shares: Number(p.shares ?? 0),
    saves: Number(p.saves ?? 0),
    watch_time_seconds: p.watch_time_seconds == null ? null : Number(p.watch_time_seconds),
    retention: p.retention == null ? null : Number(p.retention)
  })) : [];

  return res.status(202).json({
    accepted: true,
    platform,
    account_id,
    received_posts: normalized.length,
    received_audience_activity: Boolean(audience_activity),
    next_step: "Pass normalized metrics to /api/account-insights and /api/schedule-decision.",
    data: { posts: normalized, audience_activity }
  });
}
