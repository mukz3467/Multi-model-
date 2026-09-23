function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function scoreWindow(window, context) {
  let score = 0;
  const evidence = [];

  const activity = context.audience_activity?.[String(window.hour)];
  if (activity != null) {
    score += n(activity) * 0.5;
    evidence.push({ type: "audience_activity", value: activity });
  }

  const historical = (context.historical_windows || []).find(
    x => String(x.hour) === String(window.hour)
  );
  if (historical?.avg_views != null) {
    score += n(historical.avg_views) * 0.3;
    evidence.push({ type: "historical_views", value: historical.avg_views });
  }

  const topic = context.topic_performance || [];
  const topicRow = topic.find(x => x.topic === context.content?.topic);
  if (topicRow?.avg_views != null) {
    score += n(topicRow.avg_views) * 0.15;
    evidence.push({ type: "topic_performance", value: topicRow.avg_views });
  }

  const recencyPenalty = n(window.minutes_from_now) < 30 ? 5 : 0;
  score -= recencyPenalty;

  return { ...window, score, evidence };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { content = {}, context = {}, candidate_windows = [] } = req.body || {};
  if (!Array.isArray(candidate_windows) || !candidate_windows.length) {
    return res.status(400).json({ error: "candidate_windows is required." });
  }

  const ranked = candidate_windows.map(w => scoreWindow(w, context))
    .sort((a, b) => b.score - a.score);

  const hasPersonalizedEvidence =
    Boolean(context.audience_activity) ||
    Boolean(context.historical_windows?.length) ||
    Boolean(context.topic_performance?.length);

  res.json({
    decision: ranked[0],
    alternatives: ranked.slice(1, 5),
    basis: hasPersonalizedEvidence
      ? "account-specific evidence"
      : "fallback heuristic",
    content: {
      topic: content.topic || null,
      format: content.format || null,
      platform: content.platform || null
    },
    note: hasPersonalizedEvidence
      ? "Window selection uses the supplied account signals."
      : "No account analytics were supplied, so this is not personalized scheduling."
  });
}
