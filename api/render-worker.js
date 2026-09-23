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

function normalizeCuts(plan = {}) {
  return (Array.isArray(plan.cuts) ? plan.cuts : [])
    .filter(x => x?.action === "remove" && n(x.end) > n(x.start))
    .sort((a, b) => n(a.start) - n(b.start))
    .slice(0, 30);
}

function mapTime(t, cuts) {
  let x = n(t);
  let removed = 0;
  for (const c of cuts) {
    const s = n(c.start), e = n(c.end);
    if (x >= e) removed += e - s;
    else if (x > s) return s - removed;
    else break;
  }
  return Math.max(0, x - removed);
}

function mapWindow(start, end, cuts) {
  const s = mapTime(start, cuts);
  const e = mapTime(end, cuts);
  return { start: s, end: Math.max(s, e) };
}

async function downloadFile(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Asset download failed: ${r.status}`);
  await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
}

function buildVideoGraph(plan = {}, brollInputs = [], sceneInputIndex = null) {
  const captions = Array.isArray(plan.captions) ? plan.captions.slice(0, 80) : [];
  const overlays = Array.isArray(plan.overlays) ? plan.overlays.slice(0, 50) : [];
  const cuts = normalizeCuts(plan);

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
      const vt = seg.end == null ? `start=${seg.start}` : `start=${seg.start}:end=${seg.end}`;
      const at = seg.end == null ? `start=${seg.start}` : `start=${seg.start}:end=${seg.end}`;
      const vl = `vcut${i}`, al = `acut${i}`;
      parts.push(`[0:v]trim=${vt},setpts=PTS-STARTPTS[${vl}]`);
      parts.push(`[0:a]atrim=${at},asetpts=PTS-STARTPTS[${al}]`);
      v.push(`[${vl}]`);
      a.push(`[${al}]`);
    });
    parts.push(`${v.join("")}concat=n=${v.length}:v=1:a=0[vcutjoined]`);
    parts.push(`${a.join("")}concat=n=${a.length}:v=0:a=1[acutjoined]`);
    source = "[vcutjoined]";
    audioSource = "[acutjoined]";
  }

  const scene = plan.scene_compositing || {};
  const hasBackground = Number.isInteger(sceneInputIndex) && Boolean(scene.background_required || scene.background_url);

  if (hasBackground) {
    const keyColor = String(scene.key_color || "0x00ff00");
    const similarity = clamp(scene.similarity ?? 0.12, 0.01, 0.5, 0.12);
    const blend = clamp(scene.blend ?? 0.08, 0, 1, 0.08);
    const scale = clamp(scene.scale ?? 1, 0.65, 1.35, 1);
    const x = clamp(scene.position?.x ?? 0.5, 0, 1, 0.5);
    const y = clamp(scene.position?.y ?? 0.62, 0, 1, 0.62);
    const brightness = clamp(scene.brightness ?? 0, -0.25, 0.25, 0);
    const contrast = clamp(scene.contrast ?? 1, 0.7, 1.3, 1);
    const saturation = clamp(scene.saturation ?? 1, 0.7, 1.3, 1);
    const bgBlur = clamp(scene.background_blur ?? 0, 0, 20, 0);

    parts.push(
      `[${sceneInputIndex}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1${bgBlur > 0 ? `,gblur=sigma=${bgBlur}` : ""}[scene_bg]`
    );
    parts.push(
      `${source}scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,chromakey=${keyColor}:${similarity}:${blend},eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}[scene_fg]`
    );

    const subjectWidth = Math.round(1080 * scale);
    const subjectX = Math.round((1080 - subjectWidth) * x);
    const subjectY = Math.round((1920 - Math.round(1920 * scale)) * y);
    parts.push(
      `[scene_fg]scale=${subjectWidth}:-2:force_original_aspect_ratio=decrease[scene_subject]`
    );
    parts.push(
      `[scene_bg][scene_subject]overlay=x=${subjectX}:y=${subjectY}:eof_action=repeat[vbase]`
    );
  } else {
    parts.push(`${source}scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[vbase]`);
  }

  let current = "[vbase]";
  let index = 0;

  for (const o of overlays) {
    if (o.type !== "zoom") continue;
    const w = mapWindow(n(o.start), n(o.end, n(o.start) + 1), cuts);
    if (w.end <= w.start) continue;
    const amount = clamp(o.amount ?? o.zoom ?? 1.08, 1, 1.35, 1.08);
    const out = `vfx${index++}`;
    parts.push(
      `${current}zoompan=z='if(between(in_time,${w.start},${w.end}),${amount},1)':d=1:s=1080x1920:fps=30:eval=frame[${out}]`
    );
    current = `[${out}]`;
  }

  for (const c of captions) {
    const w = mapWindow(n(c.start), n(c.end, n(c.start) + 2), cuts);
    const text = esc(c.text);
    if (!text || w.end <= w.start) continue;
    const out = `vfx${index++}`;
    const y = c.position === "center" ? "h*0.50" : c.position === "top" ? "h*0.16" : "h*0.78";
    parts.push(
      `${current}drawtext=text='${text}':x=(w-text_w)/2:y=${y}:fontsize=h/22:fontcolor=white:borderw=4:bordercolor=black:box=1:boxcolor=black@0.28:enable='between(t,${w.start},${w.end})'[${out}]`
    );
    current = `[${out}]`;
  }

  for (const o of overlays) {
    if (!["text", "highlight"].includes(o.type)) continue;
    const w = mapWindow(n(o.start), n(o.end, n(o.start) + 2), cuts);
    const text = esc(o.text || o.instruction || "");
    if (!text || w.end <= w.start) continue;
    const out = `vfx${index++}`;
    const y = o.position === "top" ? "h*0.16" : o.position === "center" ? "h*0.50" : "h*0.68";
    parts.push(
      `${current}drawtext=text='${text}':x=(w-text_w)/2:y=${y}:fontsize=h/25:fontcolor=white:borderw=3:bordercolor=black:box=1:boxcolor=black@0.38:enable='between(t,${w.start},${w.end})'[${out}]`
    );
    current = `[${out}]`;
  }

  // Only overlay B-roll when an upstream stage supplied a real asset URL.
  for (let i = 0; i < brollInputs.length; i++) {
    const item = brollInputs[i];
    const w = mapWindow(n(item.start), n(item.end, n(item.start) + 2), cuts);
    if (w.end <= w.start) continue;
    const inputIndex = i + 1;
    const scaled = `brollscaled${i}`;
    const out = `brollout${i}`;
    const opacity = clamp(item.opacity ?? 1, 0.05, 1, 1);
    const position = item.position === "top" ? "(W-w)/2:80" :
      item.position === "bottom" ? "(W-w)/2:H-h-120" :
      item.position === "left" ? "80:(H-h)/2" :
      item.position === "right" ? "W-w-80:(H-h)/2" : "(W-w)/2:(H-h)/2";
    const width = clamp(item.width ?? (item.mode === "full" ? 1080 : 760), 180, 1080, 760);
    parts.push(
      `[${inputIndex}:v]setpts=PTS-STARTPTS,scale=${width}:-2:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${opacity}[${scaled}]`
    );
    parts.push(
      `${current}[${scaled}]overlay=x=${position.split(":")[0]}:y=${position.split(":")[1]}:enable='between(t,${w.start},${w.end})':eof_action=repeat[${out}]`
    );
    current = `[${out}]`;
  }

  parts.push(`${current}format=yuv420p[vfinal]`);

  let audio = audioSource;
  const audioPlan = Array.isArray(plan.audio) ? plan.audio : [];
  let audioIndex = 0;
  for (const a of audioPlan) {
    if (a.action !== "duck") continue;
    const w = mapWindow(n(a.start), n(a.end, n(a.start) + 1), cuts);
    if (w.end <= w.start) continue;
    const out = `aduck${audioIndex++}`;
    const amount = clamp(a.amount ?? 0.35, 0.05, 1, 0.35);
    parts.push(`${audio}volume=enable='between(t,${w.start},${w.end})':volume=${amount}[${out}]`);
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

    const rawBroll = Array.isArray(b.plan?.broll) ? b.plan.broll : [];
    const broll = rawBroll
      .filter(x => x?.asset_url || x?.source_url)
      .slice(0, 12)
      .map((x, i) => ({ ...x, url: x.asset_url || x.source_url, i }));

    const brollInputs = [];
    const inputArgs = ["-y", "-i", input];
    for (const item of broll) {
      const file = path.join(dir, `broll-${item.i}`);
      await downloadFile(item.url, file);
      brollInputs.push(item);
      inputArgs.push("-i", file);
    }

    const scenePlan = b.plan?.scene_compositing || {};
    let sceneInputIndex = null;
    if (scenePlan.background_url && scenePlan.background_required) {
      const sceneFile = path.join(dir, "scene-background");
      await downloadFile(scenePlan.background_url, sceneFile);
      sceneInputIndex = brollInputs.length + 1;
      inputArgs.push("-i", sceneFile);
    }

    const { filterComplex, mapVideo, mapAudio } = buildVideoGraph(
      b.plan || {},
      brollInputs,
      sceneInputIndex
    );
    const args = [
      ...inputArgs,
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
        broll: broll.length,
        green_screen: Boolean(sceneInputIndex),
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
