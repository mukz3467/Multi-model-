function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normalized(value, values) {
  const nums = values.map(v => n(v)).filter(v => v > 0);
  if (!nums.length || !n(value)) return 0;
  return Math.min(1, n(value) / Math.max(...nums));
}

function scoreWindow(window, context) {
  const activityValues = Object.values(context.audience_activity || {}).map(n);
  const historical = context.historical_windows || [];
  const histValues = historical.map(x => x.avg_views);
  const topic = context.topic_performance || [];
  const topicRow = topic.find(x => String(x.topic) === String(context.content?.topic));
  const formatRows = context.format_performance || [];
  const formatRow = formatRows.find(x => String(x.format) === String(context.content?.format));

  const activity = context.audience_activity?.[String(window.hour)];
  const historicalRow = historical.find(x => String(x.hour) === String(window.hour));
  const topicScore = topicRow?.avg_views;
  const formatScore = formatRow?.avg_views;

  const evidence = [];
  let score = 0;

  if (activity != null && activityValues.length) {
    score += normalized(activity, activityValues) * 45;
    evidence.push({type:"audience_activity", value:activity});
  }
  if (historicalRow?.avg_views != null && histValues.length) {
    score += normalized(historicalRow.avg_views, histValues) * 30;
    evidence.push({type:"historical_views", value:historicalRow.avg_views});
  }
  if (topicScore != null) {
    score += normalized(topicScore, topic.map(x=>x.avg_views)) * 15;
    evidence.push({type:"topic_performance", value:topicScore});
  }
  if (formatScore != null) {
    score += normalized(formatScore, formatRows.map(x=>x.avg_views)) * 10;
    evidence.push({type:"format_performance", value:formatScore});
  }

  const recencyPenalty = n(window.minutes_from_now) < 30 ? 5 : 0;
  score = Math.max(0, score - recencyPenalty);
  return {...window, score:Number(score.toFixed(3)), evidence};
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({error:"POST only"});
  const {content={}, context={}, candidate_windows=[]}=req.body||{};
  if (!Array.isArray(candidate_windows)||!candidate_windows.length)
    return res.status(400).json({error:"candidate_windows is required."});

  const ranked=candidate_windows.map(w=>scoreWindow(w,context)).sort((a,b)=>b.score-a.score);
  const hasPersonalizedEvidence=Boolean(context.audience_activity)||Boolean(context.historical_windows?.length)||
    Boolean(context.topic_performance?.length)||Boolean(context.format_performance?.length);

  const evidenceCount = ranked[0]?.evidence?.length || 0;
  const confidence = evidenceCount >= 3 ? "high" : evidenceCount >= 2 ? "medium" : evidenceCount === 1 ? "low" : "insufficient";

  res.json({
    decision:ranked[0], alternatives:ranked.slice(1,5),
    basis:hasPersonalizedEvidence?"account-specific evidence":"fallback heuristic",
    confidence,
    evidence_count:evidenceCount,
    content:{topic:content.topic||null,format:content.format||null,platform:content.platform||null},
    learning:{used_topics:Boolean(context.topic_performance?.length),used_formats:Boolean(context.format_performance?.length),used_audience_activity:Boolean(context.audience_activity)},
    note:hasPersonalizedEvidence?"Window selection uses supplied account signals; confidence reflects evidence coverage.":"No account analytics were supplied, so this is not personalized scheduling."
  });
}
