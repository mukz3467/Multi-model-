const UA = "Multi-Model-AI/1.1 (autonomous media asset intelligence)";

function cleanQuery(value) {
  return String(value || "")
    .replace(/\b(4k|8k|hd|1080p|vertical|stock footage|realistic professional environment|no people|no text|no logos)\b/gi, "")
    .replace(/\s+/g, " ").trim().slice(0, 180);
}

function scoreResult(title, query, mime, size, type) {
  const q = cleanQuery(query).toLowerCase().split(/\s+/).filter(Boolean);
  const text = String(title || "").toLowerCase();
  const hits = q.reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0);
  let score = q.length ? hits / q.length : 0;
  if (type === "video" && (/video\//i.test(mime || "") || /webm|mp4|mov|ogv/i.test(mime || ""))) score += 0.15;
  if (type === "background" && /^image\//i.test(mime || "")) score += 0.2;
  if (/people|person|portrait|selfie|face|logo|text|screenshot/i.test(text)) score -= 0.25;
  if (Number(size) > 0 && Number(size) < 250 * 1024 * 1024) score += 0.05;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

async function searchCommons(query, type = "video", limit = 8) {
  const fileType = type === "background" ? "image" : "video";
  const params = new URLSearchParams({
    action: "query", generator: "search",
    gsrsearch: "filetype:" + fileType + " " + cleanQuery(query),
    gsrnamespace: "6", gsrlimit: String(Math.min(Math.max(limit, 1), 10)),
    prop: "imageinfo", iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "1280", format: "json", origin: "*"
  });
  const r = await fetch("https://commons.wikimedia.org/w/api.php?" + params, {
    headers: { "User-Agent": UA, Accept: "application/json" }
  });
  if (!r.ok) throw new Error("Wikimedia search failed: " + r.status);
  const json = await r.json();
  return Object.values(json?.query?.pages || {}).map(page => {
    const info = page.imageinfo?.[0] || {};
    const meta = info.extmetadata || {};
    const title = String(page.title || "").replace(/^File:/, "");
    const license = meta.LicenseShortName?.value || meta.License?.value || "License metadata unavailable";
    const creator = meta.Artist?.value || meta.Credit?.value || "";
    const pageUrl = "https://commons.wikimedia.org/wiki/" + encodeURIComponent(page.title || "").replace(/%3A/g, ":");
    return {
      title, source: "Wikimedia Commons", source_url: info.url || "",
      preview_url: info.thumburl || "", page_url: pageUrl,
      mime: info.mime || "", size: Number(info.size || 0), license,
      creator: String(creator).replace(/<[^>]+>/g, "").slice(0, 300),
      score: scoreResult(title, query, info.mime, info.size, type)
    };
  }).filter(x => x.source_url);
}

async function searchOne(item) {
  const type = item.type === "background" ? "background" : "video";
  const query = cleanQuery(item.search_query || item.purpose || "");
  if (!query) return { ...item, type, assets: [], status: "no_query" };
  try {
    const assets = await searchCommons(query, type, 8);
    assets.sort((a, b) => b.score - a.score);
    const selected = assets[0] || null;
    return {
      ...item, type, search_query: query, assets,
      selected: selected ? {
        asset_url: selected.source_url, source: selected.source,
        title: selected.title, page_url: selected.page_url,
        preview_url: selected.preview_url, license: selected.license,
        creator: selected.creator, score: selected.score
      } : null,
      status: selected ? "candidate_found" : "no_match"
    };
  } catch (error) {
    return { ...item, type, search_query: query, assets: [], status: "search_failed", error: error.message };
  }
}

function attachBackground(plan, selected) {
  if (!selected || !plan || typeof plan !== "object") return;
  plan.scene_compositing = plan.scene_compositing || {};
  plan.scene_compositing.background_required = true;
  plan.scene_compositing.background_url = selected.asset_url;
  plan.scene_compositing.background_source = selected.source;
  plan.scene_compositing.background_title = selected.title;
  plan.scene_compositing.background_page_url = selected.page_url;
  plan.scene_compositing.background_license = selected.license;
  plan.scene_compositing.background_creator = selected.creator;
  plan.scene_compositing.background_match_score = selected.score;
  plan.scene_compositing.background_asset_status = "candidate_found";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const body = req.body || {};
    const items = Array.isArray(body.broll) ? body.broll.slice(0, 12) : [];
    const background = body.background && typeof body.background === "object" ? body.background : null;
    if (!items.length && !background) return res.status(400).json({ error: "broll or background request is required." });

    const results = [];
    for (const item of items) results.push(await searchOne(item));
    let backgroundResult = null;
    if (background) backgroundResult = await searchOne({ ...background, type: "background" });

    const plan = body.plan && typeof body.plan === "object" ? structuredClone(body.plan) : null;
    if (body.attach === true && plan) {
      plan.broll = Array.isArray(plan.broll) ? plan.broll : [];
      for (let i = 0; i < Math.min(plan.broll.length, results.length); i++) {
        const picked = results[i]?.selected;
        if (!picked) continue;
        plan.broll[i] = { ...plan.broll[i], asset_url:picked.asset_url, asset_status:"candidate_found",
          asset_source:picked.source, asset_title:picked.title, asset_page_url:picked.page_url,
          asset_license:picked.license, asset_creator:picked.creator, asset_match_score:picked.score };
      }
      if (backgroundResult?.selected) attachBackground(plan, backgroundResult.selected);
    }

    return res.status(200).json({
      ok:true, provider:"Wikimedia Commons", results, background_result:backgroundResult, plan,
      license_note:"Each result includes source license metadata. Verify attribution/usage requirements before publishing."
    });
  } catch (error) {
    return res.status(500).json({ error:error.message || "Asset intelligence failed." });
  }
}
