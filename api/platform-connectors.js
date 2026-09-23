const connectors = {
  youtube: {
    name: "YouTube",
    auth: "OAuth 2.0",
    capabilities: ["upload", "schedule", "analytics"]
  },
  instagram: {
    name: "Instagram",
    auth: "Meta OAuth",
    capabilities: ["publish", "schedule", "insights"]
  },
  facebook: {
    name: "Facebook",
    auth: "Meta OAuth",
    capabilities: ["publish", "schedule", "insights"]
  },
  tiktok: {
    name: "TikTok",
    auth: "TikTok OAuth",
    capabilities: ["publish", "schedule", "analytics"]
  }
};

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      connectors,
      note: "Connection requires the platform's official OAuth flow and user authorization."
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

  const { action, platform } = req.body || {};
  if (!connectors[platform]) return res.status(400).json({ error: "Unsupported platform." });

  if (action === "status") {
    return res.json({
      platform,
      connected: false,
      status: "oauth_required",
      message: "No connection is claimed until OAuth credentials and callback handling are configured."
    });
  }

  return res.status(400).json({
    error: "Unsupported connector action.",
    supported_actions: ["status"]
  });
}
