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

  const { content = {}, account = {}, posts = [], candidate_windows = [], daily_limit, selection_mode } = req.body || {};
  if (!candidate_windows.length) return res.status(400).json({ error: "candidate_windows is required." });

  try {
    if (daily_limit != null || selection_mode != null) {
      await call("/api/publishing-settings", {
        daily_limit: daily_limit == null ? 2 : daily_limit,
        selection_mode: selection_mode || "ai_best"
      });
    }

    let learning = { posts: [], audience_activity: null };
    if (account.platform && account.account_id) {
      try {
        const response = await fetch(new URL("/api/learning-memory?platform=" + encodeURIComponent(account.platform) + "&account_id=" + encodeURIComponent(account.account_id), process.env.APP_BASE_URL));
        if (response.ok) learning = (await response.json()).learning || learning;
      } catch {}
    }
    const mergedPosts = [...(learning.posts || []), ...(Array.isArray(posts) ? posts : [])];
    const mergedAccount = { ...account, audience_activity: account.audience_activity || learning.audience_activity || null };
    const insights = await call("/api/account-insights", { account: mergedAccount, posts: mergedPosts });
    const decision = await call("/api/schedule-decision", {
      content, candidate_windows,
      context: {
        audience_activity: insights.audience_activity,
        historical_windows: insights.patterns.posting_hours,
        topic_performance: insights.patterns.topics,
        format_performance: insights.patterns.formats
      }
    });
    if (account.platform && account.account_id && Array.isArray(posts) && posts.length) {
      try {
        await call("/api/learning-memory", { platform:account.platform, account_id:account.account_id, posts, audience_activity:mergedAccount.audience_activity });
      } catch {}
    }

    let queued = null;
    // When the caller supplies a completed media object's pathname and an OAuth
    // connection, autopilot can hand the item to the durable cron queue.
    if (content.source_pathname && account.connection_id && content.platform) {
      const scheduledAt = decision.decision?.scheduled_at ||
        (decision.decision?.minutes_from_now != null
          ? new Date(Date.now() + Number(decision.decision.minutes_from_now) * 60000).toISOString()
          : new Date().toISOString());

      queued = await call("/api/auto-publish", {
        source_pathname: content.source_pathname,
        platform: content.platform,
        connection_id: account.connection_id,
        page_id: account.page_id || null,
        title: content.title || "",
        caption: content.caption || content.description || "",
        scheduled_at: scheduledAt,
        priority_score: Number(decision.decision?.score || 0)
      });
    }

    return res.json({
      mode: "autopilot",
      insights,
      schedule_decision: decision,
      queued,
      next: {
        action: queued ? "background_queue" : "authenticated_platform_publish",
        requires_oauth: !queued
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Autopilot orchestration failed.", details: error.message });
  }
}
