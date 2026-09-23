import { get, put } from "@vercel/blob";

const KEY = "settings/publishing-default.json";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function defaultSettings() {
  return {
    daily_limit: 2,
    selection_mode: "ai_best",
    published_today: 0,
    date: todayUtc(),
    updated_at: new Date().toISOString()
  };
}

async function readSettings() {
  try {
    const result = await get(KEY, { access: "private" });
    if (!result || result.statusCode !== 200) return defaultSettings();
    const data = await new Response(result.stream).json();
    if (data.date !== todayUtc()) {
      return { ...data, published_today: 0, date: todayUtc(), updated_at: new Date().toISOString() };
    }
    return data;
  } catch {
    return defaultSettings();
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const settings = await readSettings();
      return res.status(200).json({
        ...settings,
        daily_remaining: Math.max(0, settings.daily_limit - settings.published_today)
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const dailyLimit = Math.max(1, Math.min(100, Number(body.daily_limit || 2)));
      const selectionMode = body.selection_mode === "queue_order" ? "queue_order" : "ai_best";
      const current = await readSettings();

      const settings = {
        daily_limit: dailyLimit,
        selection_mode: selectionMode,
        published_today: Math.min(Number(current.published_today || 0), dailyLimit),
        date: todayUtc(),
        updated_at: new Date().toISOString()
      };

      await put(KEY, JSON.stringify(settings), {
        access: "private",
        contentType: "application/json",
        allowOverwrite: true
      });

      return res.status(200).json({
        ...settings,
        daily_remaining: Math.max(0, settings.daily_limit - settings.published_today)
      });
    }

    return res.status(405).json({ error: "GET or POST only" });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Publishing settings error." });
  }
}
