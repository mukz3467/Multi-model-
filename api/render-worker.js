import { get, put } from "@vercel/blob";
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
function n(v,f=0){const x=Number(v);return Number.isFinite(x)&&x>=0?x:f;}
function esc(v){return String(v||"").replace(/\\/g,"\\\\").replace(/:/g,"\\:").replace(/'/g,"\\'");}
function filters(plan={}) {
  const out=[];
  for(const c of (Array.isArray(plan.cuts)?plan.cuts:[]).filter(x=>x.action==="remove"&&n(x.end)>n(x.start)).slice(0,50)){
    out.push(`trim=start=0:end=${n(c.start)},setpts=PTS-STARTPTS`);
  }
  for(const c of (Array.isArray(plan.captions)?plan.captions:[]).slice(0,80)){
    const s=n(c.start),e=n(c.end,s+2),t=esc(c.text);
    if(t&&e>s) out.push(`drawtext=text='${t}':x=(w-text_w)/2:y=h*0.78:fontsize=h/22:fontcolor=white:borderw=4:bordercolor=black:enable='between(t,${s},${e})'`);
  }
  out.push("scale=1080:1920:force_original_aspect_ratio=decrease","pad=1080:1920:(ow-iw)/2:(oh-ih)/2");
  return out.join(",");
}
async function body(req){if(req.body)return req.body;return JSON.parse(await new Response(req).text());}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST only"});
  if(!auth(req))return res.status(401).json({error:"Unauthorized"});
  if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(500).json({error:"BLOB_READ_WRITE_TOKEN is not configured."});
  const b=req.body||{};
  if(!b.source_url)return res.status(400).json({error:"source_url is required."});
  const id=crypto.randomUUID(),dir=await fs.mkdtemp(path.join(os.tmpdir(),`mm-v-${id}-`));
  const input=path.join(dir,"input.mp4"),output=path.join(dir,"output.mp4");
  try{
    const src=await fetch(b.source_url);if(!src.ok)throw new Error(`Source download failed: ${src.status}`);
    await fs.writeFile(input,Buffer.from(await src.arrayBuffer()));
    const args=["-y","-i",input,"-vf",filters(b.plan||{}),"-c:v","libx264","-preset",process.env.FFMPEG_PRESET||"veryfast","-crf",String(b.output?.crf??22),"-c:a","aac","-b:a","160k","-movflags","+faststart",output];
    await exec(ffmpegPath,args,{timeout:Number(process.env.RENDER_TIMEOUT_MS||240000),maxBuffer:10*1024*1024});
    const data=await fs.readFile(output);
    const pathname=b.output_pathname||`processed/${id}.mp4`;
    const blob=await put(pathname,data,{access:"private",contentType:"video/mp4",addRandomSuffix:false,allowOverwrite:true});
    return res.status(200).json({rendered:true,output_pathname:blob.pathname,output_url:blob.url,size:data.length,renderer:"vercel-ffmpeg"});
  }catch(e){return res.status(500).json({error:"Rendering failed.",details:e?.message||"Unknown FFmpeg error."});}
  finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}