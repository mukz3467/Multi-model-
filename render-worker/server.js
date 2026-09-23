import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const exec = promisify(execFile);
const app = express();
app.use(express.json({ limit: "100mb" }));

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.RENDER_WORKER_TOKEN || "";

function auth(req, res) {
  if (!TOKEN) return true;
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.status(401).json({ error: "Unauthorized render worker request." });
    return false;
  }
  return true;
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : fallback;
}

function ffText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function buildSceneFilters(scene = {}) {
  const keyColor = scene.key_color || "0x00ff00";
  const similarity = Math.min(Math.max(Number(scene.similarity ?? 0.12), 0.01), 1);
  const blend = Math.min(Math.max(Number(scene.blend ?? 0.08), 0), 1);
  return `chromakey=color=${keyColor}:similarity=${similarity}:blend=${blend}`;
}

function buildFilters(plan = {}) {
  const filters = [];
  const cuts = (Array.isArray(plan.cuts) ? plan.cuts : [])
    .filter(c => c.action === "remove" && n(c.end) > n(c.start))
    .sort((a, b) => n(a.start) - n(b.start));

  if (cuts.length) {
    const keep = [];
    let cursor = 0;
    for (const cut of cuts) {
      const start = n(cut.start);
      const end = n(cut.end);
      if (start > cursor) keep.push(`between(t,${cursor},${start})`);
      cursor = Math.max(cursor, end);
    }
    keep.push(`gte(t,${cursor})`);
    filters.push(`select='${keep.join("+")}'`, "setpts=N/FRAME_RATE/TB");
  }

  for (const caption of (Array.isArray(plan.captions) ? plan.captions : []).slice(0, 120)) {
    const start = n(caption.start);
    const end = n(caption.end, start + 2);
    const text = ffText(caption.text);
    if (end <= start || !text) continue;
    filters.push(
      `drawtext=text='${text}':x=(w-text_w)/2:y=h*0.78:fontsize=h/22:fontcolor=white:borderw=4:bordercolor=black:enable='between(t,${start},${end})'`
    );
  }

  filters.push(
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2"
  );
  return filters.join(",");
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "multi-model-render-worker", ffmpeg: "required" });
});

app.post("/render", async (req, res) => {
  if (!auth(req, res)) return;

  const { videoBase64, plan = {}, output = {}, backgroundBase64 = "", scene = {} } = req.body || {};
  if (!videoBase64) return res.status(400).json({ error: "videoBase64 is required." });

  const id = crypto.randomUUID();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mm-render-${id}-`));
  const input = path.join(dir, "input.mp4");
  const result = path.join(dir, "output.mp4");
  const background = backgroundBase64 ? path.join(dir, "background.png") : null;

  try {
    await fs.writeFile(input, Buffer.from(videoBase64, "base64"));
    if (background) await fs.writeFile(background, Buffer.from(backgroundBase64, "base64"));
    let filters = buildFilters(plan);
    const sceneFilter = scene.enabled && background ? buildSceneFilters(scene) : null;
    if (sceneFilter) filters = `${sceneFilter},${filters}`;
    const args = background ? [
      "-y", "-i", background, "-i", input,
      "-filter_complex", `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];[1:v]${filters}[fg];[bg][fg]overlay=shortest=1:format=auto[v]`,
      "-map", "[v]", "-map", "1:a?",
      "-c:v", "libx264",
      "-preset", process.env.FFMPEG_PRESET || "veryfast",
      "-crf", String(output.crf ?? 20),
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", result
    ] : [
      "-y", "-i", input,
      "-vf", filters,
      "-c:v", "libx264",
      "-preset", process.env.FFMPEG_PRESET || "veryfast",
      "-crf", String(output.crf ?? 20),
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      result
    ];

    await exec("ffmpeg", args, { timeout: Number(process.env.RENDER_TIMEOUT_MS || 900000) });
    const data = await fs.readFile(result);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'attachment; filename="multi-model-edited.mp4"');
    res.status(200).send(data);
  } catch (error) {
    res.status(500).json({
      error: "Rendering failed.",
      details: error?.message || "Unknown FFmpeg error."
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`Multi-Model render worker listening on :${PORT}`);
});
