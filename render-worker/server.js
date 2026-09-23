import express from "express";
import { put } from "@vercel/blob";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const exec = promisify(execFile);
const app = express();
app.use(express.json({ limit: "30mb" }));

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
function clamp(v, min, max, fallback) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(Math.max(x, min), max) : fallback;
}
function ffText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function buildKeyFilter(scene = {}) {
  const keyColor = scene.key_color || "0x00ff00";
  const similarity = clamp(scene.similarity, 0.01, 1, 0.12);
  const blend = clamp(scene.blend, 0, 1, 0.08);
  return `chromakey=color=${keyColor}:similarity=${similarity}:blend=${blend},format=rgba`;
}

function buildFilters(plan = {}) {
  const filters = [];
  for (const caption of (Array.isArray(plan.captions) ? plan.captions : []).slice(0, 120)) {
    const start = n(caption.start), end = n(caption.end, start + 2), text = ffText(caption.text);
    if (end <= start || !text) continue;
    filters.push(`drawtext=text='${text}':x=(w-text_w)/2:y=h*0.78:fontsize=h/22:fontcolor=white:borderw=4:bordercolor=black:enable='between(t,${start},${end})'`);
  }
  filters.push("scale=1080:1920:force_original_aspect_ratio=decrease", "pad=1080:1920:(ow-iw)/2:(oh-ih)/2");
  return filters.join(",");
}

function buildSceneGraph(scene = {}, backgroundPath, inputPath, plan = {}) {
  const position = scene.position || {};
  const scale = clamp(scene.scale, 0.2, 2.5, 1);
  const x = Number.isFinite(Number(position.x)) ? Number(position.x) : 0.5;
  const y = Number.isFinite(Number(position.y)) ? Number(position.y) : 0.62;
  const brightness = clamp(scene.brightness, -0.35, 0.35, 0);
  const contrast = clamp(scene.contrast, 0.5, 1.5, 1);
  const saturation = clamp(scene.saturation, 0.5, 1.5, 1);
  const blur = clamp(scene.background_blur, 0, 12, 0);
  const shadowOpacity = clamp(scene.shadow_opacity, 0, 0.45, 0.16);

  const fgWidth = Math.round(1080 * scale);
  const fgX = Math.round(1080 * x - fgWidth / 2);
  const fgY = Math.round(1920 * y - 960 * scale);

  const graph = [
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${blur > 0 ? `,boxblur=${blur}:1` : ""}[bg]`,
    `[1:v]scale=${fgWidth}:-2,setsar=1,${buildKeyFilter(scene)},eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation},unpremultiply[fg0]`,
    `color=c=black@0.0:s=1080x1920,format=rgba[shadow]`,
    `[shadow][fg0]overlay=x=${fgX}:y=${fgY}:format=auto[shadowbase]`,
    `[bg][shadowbase]overlay=0:0:format=auto[comp]`,
    `[comp][fg0]overlay=x=${fgX}:y=${fgY}:format=auto,format=yuv420p[v0]`,
    `[v0]${buildFilters(plan)}[v]`
  ];

  // Shadow is deliberately subtle; it grounds the keyed subject without pretending
  // to know exact physical floor geometry.
  if (shadowOpacity > 0) {
    graph.splice(3, 0, `[fg0]alphaextract,boxblur=18:2,colorchannelmixer=aa=${shadowOpacity}[alpha]`);
    graph.splice(4, 0, `color=c=black@0.0:s=1080x1920,format=rgba[shadow]`);
    graph.splice(5, 0, `[shadow][alpha]overlay=x=${fgX}:y=${fgY + Math.round(35 * scale)}:format=auto[shadowbase]`);
  }

  return graph.join(";");
}

async function download(url, target) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Source download failed: ${r.status}`);
  await fs.writeFile(target, Buffer.from(await r.arrayBuffer()));
}

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "multi-model-render-worker", ffmpeg: "required", storage: "vercel-blob" })
);

app.post("/render", async (req, res) => {
  if (!auth(req, res)) return;
  const body = req.body || {};
  const { videoBase64, source_url, plan = {}, output = {}, backgroundBase64 = "", scene = {}, output_pathname = "" } = body;

  if (!videoBase64 && !source_url) return res.status(400).json({ error: "source_url or videoBase64 is required." });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is not configured on render worker." });

  const id = crypto.randomUUID();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mm-render-${id}-`));
  const input = path.join(dir, "input.mp4");
  const result = path.join(dir, "output.mp4");
  const background = backgroundBase64 ? path.join(dir, "background.png") : null;

  try {
    if (videoBase64) await fs.writeFile(input, Buffer.from(videoBase64, "base64"));
    else await download(source_url, input);
    if (background) await fs.writeFile(background, Buffer.from(backgroundBase64, "base64"));

    const hasScene = Boolean(background && scene.enabled);
    const args = hasScene
      ? [
          "-y", "-i", background, "-i", input,
          "-filter_complex", buildSceneGraph(scene, background, input, plan),
          "-map", "[v]", "-map", "1:a?",
          "-c:v", "libx264", "-preset", process.env.FFMPEG_PRESET || "veryfast",
          "-crf", String(output.crf ?? 20), "-c:a", "aac", "-b:a", "160k",
          "-movflags", "+faststart", result
        ]
      : [
          "-y", "-i", input, "-vf", buildFilters(plan),
          "-c:v", "libx264", "-preset", process.env.FFMPEG_PRESET || "veryfast",
          "-crf", String(output.crf ?? 20), "-c:a", "aac", "-b:a", "160k",
          "-movflags", "+faststart", result
        ];

    await exec("ffmpeg", args, {
      timeout: Number(process.env.RENDER_TIMEOUT_MS || 900000),
      maxBuffer: 20 * 1024 * 1024
    });

    const data = await fs.readFile(result);
    const pathname = output_pathname || `processed/${id}.mp4`;
    const blob = await put(pathname, data, {
      access: "private",
      contentType: "video/mp4",
      addRandomSuffix: false,
      allowOverwrite: true
    });

    return res.status(200).json({
      rendered: true,
      output_pathname: blob.pathname,
      output_url: blob.url,
      size: data.length,
      scene_composited: hasScene,
      renderer: "external-ffmpeg"
    });
  } catch (error) {
    return res.status(500).json({ error: "Rendering failed.", details: error?.message || "Unknown FFmpeg error." });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

app.listen(PORT, () => console.log(`Multi-Model render worker listening on :${PORT}`));
