function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function avg(rows, key) {
  const values = rows.map(r => num(r[key], NaN)).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function groupBy(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const k = row[key] ?? "unknown";
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(row);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { account = {}, posts = [] } = req.body || {};
  if (!Array.isArray(posts)) return res.status(400).json({ error: "posts must be an array." });

  const rows = posts.map(p => ({
    ...p,
    views: num(p.views),
    reach: num(p.reach),
    likes: num(p.likes),
    comments: num(p.comments),
    shares: num(p.shares),
    saves: num(p.saves),
    watch_time_seconds: num(p.watch_time_seconds),
    retention: p.retention == null ? null : num(p.retention)
  }));

  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  const totalReach = rows.reduce((s, r) => s + r.reach, 0);
  const engagement = rows.reduce((s, r) => s + r.likes + r.comments + r.shares + r.saves, 0);

  const byTopic = [...groupBy(rows, "topic")].map(([topic, data]) => ({
    topic,
    posts: data.length,
    avg_views: avg(data, "views"),
    avg_reach: avg(data, "reach"),
    avg_retention: avg(data, "retention"),
    total_engagement: data.reduce((s, r) => s + r.likes + r.comments + r.shares + r.saves, 0)
  })).sort((a, b) => (b.avg_views ?? 0) - (a.avg_views ?? 0));

  const byHour = [...groupBy(rows, "published_hour")].map(([hour, data]) => ({
    hour,
    posts: data.length,
    avg_views: avg(data, "views"),
    avg_reach: avg(data, "reach"),
    avg_retention: avg(data, "retention")
  })).sort((a, b) => (b.avg_views ?? 0) - (a.avg_views ?? 0));

  const byFormat = [...groupBy(rows, "format")].map(([format, data]) => ({
    format, posts: data.length, avg_views: avg(data, "views"),
    avg_reach: avg(data, "reach"), avg_retention: avg(data, "retention"),
    avg_engagement: avg(data.map(r => ({ engagement: r.likes + r.comments + r.shares + r.saves })), "engagement")
  })).sort((a, b) => (b.avg_views ?? 0) - (a.avg_views ?? 0));

  const durationRows = rows.map(r => ({ ...r, duration_bucket:
    r.duration_seconds == null ? "unknown" : num(r.duration_seconds) <= 30 ? "0-30s" :
    num(r.duration_seconds) <= 60 ? "31-60s" : num(r.duration_seconds) <= 180 ? "61-180s" : "180s+"
  }));
  const byDuration = [...groupBy(durationRows, "duration_bucket")].map(([duration_bucket, data]) => ({
    duration_bucket, posts: data.length, avg_views: avg(data, "views"), avg_retention: avg(data, "retention")
  })).sort((a, b) => (b.avg_views ?? 0) - (a.avg_views ?? 0));
  const recent = rows.slice(-10);
  const previous = rows.slice(-20, -10);
  const recentAvg = avg(recent, "views");
  const previousAvg = avg(previous, "views");

  res.json({
    account: {
      platform: account.platform || null,
      username: account.username || null,
      timezone: account.timezone || null,
      followers: account.followers ?? null
    },
    data_quality: {
      posts_analyzed: rows.length,
      has_audience_activity: Boolean(account.audience_activity),
      has_post_timestamps: rows.some(r => r.published_at || r.published_hour)
    },
    summary: {
      total_views: totalViews,
      total_reach: totalReach,
      total_engagement: engagement,
      avg_views: avg(rows, "views"),
      avg_reach: avg(rows, "reach"),
      avg_retention: avg(rows, "retention"),
      recent_vs_previous_views_ratio:
        recentAvg != null && previousAvg ? recentAvg / previousAvg : null
    },
    patterns: {
      topics: byTopic.slice(0, 10),
      posting_hours: byHour.slice(0, 24),
      formats: byFormat.slice(0, 10),
      duration_buckets: byDuration.slice(0, 10)
    },
    audience_activity: account.audience_activity || null,
    limitations: [
      "Insights are calculated only from supplied account data.",
      "No trend, audience, reach or performance metric is invented.",
      "Small samples should be treated as directional evidence, not certainty."
    ]
  });
}
