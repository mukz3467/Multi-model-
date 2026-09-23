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
  return Number.isFinite(v = Number(v)) && v >= 0 ? v : f;
}
function clamp(v, min, max, f) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(Math.max(x, min), max) : f;
}
function esc(v) {
  return String(v || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function buildVideoGraph(plan = {}) {
  const captions = Array.isArray(plan.captions) ? plan.captions.slice(0, 80) : [];
  const overlays = Array.isArray(plan.overlays) ? plan.overlays.slice(0, 50) : [];
  const cuts = (Array.isArray(plan.cuts) ? plan.cuts : [])
    .filter(x => x?.action === "remove" && n(x.end) > n(x.start))
    .sort((a, b) => n(a.start) - n(b.start))
    .slice(0, 30);

  const parts = [];
  let source = "[0:v]";
  let audioSource = "[0:a]";

  if (cuts.length) {
    const segments = [];
    let cursor = 0;
    for (const c of cuts) {
      const start = n(c.start), end = n(c.end);
      if (start > cursor) segments.push({ start: cursor, end: start });
      cursor = Math.max(cursor, end);
    }
    segments.push({ start: cursor, end: null });

    const v = [], a = [];
    segments.forEach((seg, i) => {
      const t = seg.end == null ? `start=${seg.start}` : `start=${seg.start}:end=${seg.end}`;
      const vl = `vcut${i}`, al = `acut${i}`;
      parts.push(`[0:v]trim=${t},setpts=PTS-STARTPTS[${vl}]`);
      parts.push(`[0:a]atrim=${t},asetpts=PTS-STARTPTS[${al}]`);
      v.push(`[${vl}]`);
      a.push(`[${al}]`);
    });
    parts.push(`${v.join("")}concat=n=${v.length}:v=1:a=0[vcutjoined]`);
    parts.push(`${a.join("")}concat=n=${a.length}:v=0:a=1[acutjoined]`);
    source = "[vcutjoined]";
    audioSource = "[acutjoined]";
  }

  parts.push(`${source}scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[vbase]`);

  let current = "[vbase]";
  let index = 0;

  // Evidence-based punch-in / zoom effects.
  for (const o of overlays) {
    if (o.type !== "zoom") continue;
    const start = n(o.start), end = n(o.end, start + 1);
    if (end <= start) continue;
    const amount = clamp(o.amount ?? o.zoom ?? 1.08, 1, 1.35, 1.08);
    const out = `vfx${index++}`;
    parts.push(
      `${current}zoompan=z='if(between(in_time,${start},${end}),${amount},1)':d=1:s=1080x1920:fps=30:eval=frame[${out}]`
    );
    current = `[${out}]`;
  }

  // Dynamic captions and safe text overlays are rendered directly into the video.
  for (const c of captions) {
    const start = n(c.start), end = n(c.end, start + 2), text = esc(c.text);
    if (!text || end <= start) continue;
    const out = `vfx${index++}`;
    const y = c.position === "center" ? "h*0.50" : c.position === "top" ? "h*0.16" : "h*0.78";
    parts.push(
      `${current}drawtext=text='${text}':x=(w-text_w)/2:y=${y}:fontsize=h/22:fontcolor=white:borderw=4:bordercolor=black:box=1:boxcolor=black@0.28:enable='between(t,${start},${end})'[${out}]`
    );
    current = `[${out}]`;
  }

  // Text / highlight overlays are supported without pretending external B-roll exists.
  for (const o of overlays) {
    if (!["text", "highlight"].includes(o.type)) continue;
    const start = n(o.start), end = n(o.end, start + 2);
    const text = esc(o.text || o.instruction || "");
    if (!text || end <= start) continue;
    const out = `vfx${index++}`;
    const y = o.position === "top" ? "h*0.16" : o.position === "center" ? "h*0.50" : "h*0.68";
    parts.push(
      `${current}drawtext=text='${text}':x=(w-text_w)/2:y=${y}:fontsize=h/25:fontcolor=white:borderw=3:bordercolor=black:box=1:boxcolor=black@0.38:enable='between(t,${start},${end})'[${out}]`
    );
    current = `[${out}]`;
  }

  parts.push(`${current}format=yuv420p[vfinal]`);

  // Audio decisions: ducking is implemented as a conservative volume reduction.
  let audio = audioSource;
  const audioPlan = Array.isArray(plan.audio) ? plan.audio : [];
  let audioIndex = 0;
  for (const a of audioPlan) {
    if (a.action !== "duck") continue;
    const start = n(a.start), end = n(a.end, start + 1);
    if (end <= start) continue;
    const out = `aduck${audioIndex++}`;
    const amount = clamp(a.amount ?? 0.35, 0.05, 1, 0.35);
    parts.push(`${audio}volume=enable='between(t,${start},${end})':volume=${amount}[${out}]`);
    audio = `[${out}]`;
  }

  return { filterComplex: parts.join(";"), mapVideo: "[vfinal]", mapAudio: audio };
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

    const { filterComplex, mapVideo, mapAudio } = buildVideoGraph(b.plan || {});
    const args = [
      "-y", "-i", input,
      "-filter_complex", filterComplex,
      "-map", mapVideo, "-map", mapAudio,
      "-c:v", "libx264",
      "-preset", process.env.FFMPEG_PRESET || "veryfast",
      "-crf", String(b.output?.crf ?? 22),
      "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart", output
    ];

    await exec(ffmpegPath, args, {
      timeout: Number(process.env.RENDER_TIMEOUT_MS || 240000),
      maxBuffer: 12 * 1024 * 1024
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
      applied: {
        cuts: Array.isArray(b.plan?.cuts),
        captions: Array.isArray(b.plan?.captions),
        overlays: Array.isArray(b.plan?.overlays),
        audio: Array.isArray(b.plan?.audio)
      },
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
