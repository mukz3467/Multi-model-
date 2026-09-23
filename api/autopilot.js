async function call(path, body) {
  const base = process.env.APP_BASE_URL;
  if (!base) throw new Error("APP_BASE_URL is required for server-side autopilot calls.");
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${path}`);
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { content = {}, account = {}, posts = [], candidate_windows = [] } = req.body || {};
  if (!candidate_windows.length) {
    return res.status(400).json({ error: "candidate_windows is required." });
  }

  try {
    const insights = await call("/api/account-insights", { account, posts });
    const decision = await call("/api/schedule-decision", {
      content,
      candidate_windows,
      context: {
        audience_activity: insights.audience_activity,
        historical_windows: insights.patterns.posting_hours,
        topic_performance: insights.patterns.topics
      }
    });

    return res.json({
      mode: "autopilot",
      insights,
      schedule_decision: decision,
      next: {
        action: "authenticated_platform_publish",
        requires_oauth: true
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Autopilot orchestration failed.",
      details: error.message
    });
  }
}
