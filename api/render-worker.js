import { put } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const exec = promisify(execFile);

function auth(req) {
  return !process.env.RENDER_WORKER_TOKEN || req.headers.authorization === `Bearer ${process.env.RENDER_WORKER_TOKEN}`;
}
function n(v, f = 0) {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : f;
}
function esc(v) {
  return String(v || "").replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function buildFilter(plan = {}) {
  const captions = Array.isArray(plan.captions) ? plan.captions.slice(0, 80) : [];
  const removes = (Array.isArray(plan.cuts) ? plan.cuts : [])
    .filter(x => x?.action === "remove" && n(x.end) > n(x.start))
    .sort((a, b) => n(a.start) - n(b.start))
    .slice(0, 30);

  const vf = [];
  let filterComplex = null;
  let mapVideo = "0:v:0";
  let mapAudio = "0:a:0?";

  if (removes.length) {
    const segments = [];
    let cursor = 0;
    for (const r of removes) {
      const start = n(r.start);
      const end = n(r.end);
      if (start > cursor) segments.push({ start: cursor, end: start });
      cursor = Math.max(cursor, end);
    }
    segments.push({ start: cursor, end: null });

    const vLabels = [];
    const aLabels = [];
    const parts = [];

    segments.forEach((seg, i) => {
      const v = `vcut${i}`;
      const a = `acut${i}`;
      const time = seg.end == null
        ? `start=${seg.start}`
        : `start=${seg.start}:end=${seg.end}`;
      parts.push(`[0:v]trim=${time},setpts=PTS-STARTPTS[${v}]`);
      parts.push(`[0:a]atrim=${time},asetpts=PTS-STARTPTS[${a}]`);
      vLabels.push(`[${v}]`);
      aLabels.push(`[${a}]`);
    });

    parts.push(`${vLabels.join("")}concat=n=${segments.length}:v=1:a=0[vjoined]`);
    parts.push(`${aLabels.join("")}concat=n=${segments.length}:v=0:a=1[ajoined]`);
    filterComplex = parts.join(";");
    mapVideo = "[vjoined]";
    mapAudio = "[ajoined]";
  }

  const captionFilters = captions
    .map(c => {
      const start = n(c.start);
      const end = n(c.end, start + 2);
      const text = esc(c.text);
      return text && end > start
        ? `drawtext=text='${text}':x=(w-text_w)/2:y=h*0.78:fontsize=h/22:fontcolor=white:borderw=4:bordercolor=black:enable='between(t,${start},${end})'`
        : null;
    })
    .filter(Boolean);

  const base = [
    "scale=1080:1920:force_original_aspect_ratio=decrease",
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2"
  ];

  if (captionFilters.length) base.push(...captionFilters);

  if (filterComplex) {
    filterComplex += `;[vjoined]${base.join(",")}[vfinal]`;
    mapVideo = "[vfinal]";
  } else {
    filterComplex = `[0:v]${base.join(",")}[vfinal]`;
    mapVideo = "[vfinal]";
  }

  return { filterComplex, mapVideo, mapAudio };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!auth(req)) return res.status(401).json({ error: "Unauthorized" });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is not configured." });
  }

  const b = req.body || {};
  if (!b.source_url) return res.status(400).json({ error: "source_url is required." });

  const id = crypto.randomUUID();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mm-v-${id}-`));
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "output.mp4");

  try {
    const src = await fetch(b.source_url);
    if (!src.ok) throw new Error(`Source download failed: ${src.status}`);
    await fs.writeFile(input, Buffer.from(await src.arrayBuffer()));

    const { filterComplex, mapVideo, mapAudio } = buildFilter(b.plan || {});
    const args = [
      "-y",
      "-i", input,
      "-filter_complex", filterComplex,
      "-map", mapVideo,
      "-map", mapAudio,
      "-c:v", "libx264",
      "-preset", process.env.FFMPEG_PRESET || "veryfast",
      "-crf", String(b.output?.crf ?? 22),
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      output
    ];

    await exec(ffmpegPath, args, {
      timeout: Number(process.env.RENDER_TIMEOUT_MS || 240000),
      maxBuffer: 10 * 1024 * 1024
    });

    const data = await fs.readFile(output);
    const pathname = b.output_pathname || `processed/${id}.mp4`;
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
      renderer: "vercel-ffmpeg"
    });
  } catch (e) {
    return res.status(500).json({
      error: "Rendering failed.",
      details: e?.message || "Unknown FFmpeg error."
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export default handler;
