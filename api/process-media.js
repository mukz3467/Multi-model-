import { get, put, list, issueSignedToken, presignUrl } from "@vercel/blob";

async function read(p){const r=await get(p,{access:"private",useCache:false});if(!r||r.statusCode!==200)return null;return await new Response(r.stream).json();}
async function write(p,x){await put(p,JSON.stringify({...x,updated_at:new Date().toISOString()}),{access:"private",contentType:"application/json",allowOverwrite:true});}
function ok(req){return Boolean(process.env.CRON_SECRET&&req.headers.authorization==="Bearer "+process.env.CRON_SECRET);}
function json(s){return JSON.parse(s.replace(/^\`\`\`json\s*/i,"").replace(/\s*\`\`\`$/,"").trim());}

async function signedGet(pathname, minutes=30){
  const token=await issueSignedToken({pathname,operations:["get"]});
  const {presignedUrl}=await presignUrl(token,{pathname,operation:"get",validUntil:Date.now()+minutes*60*1000});
  return presignedUrl;
}
async function uploadGemini(buf,mime,name,key){
 const s=await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key="+encodeURIComponent(key),{method:"POST",headers:{"X-Goog-Upload-Protocol":"resumable","X-Goog-Upload-Command":"start","X-Goog-Upload-Header-Content-Length":String(buf.length),"X-Goog-Upload-Header-Content-Type":mime,"Content-Type":"application/json"},body:JSON.stringify({file:{display_name:name}})});
 if(!s.ok)throw new Error("Gemini upload init failed: "+await s.text());
 const u=s.headers.get("x-goog-upload-url")||s.headers.get("X-Goog-Upload-URL");
 const d=await fetch(u,{method:"POST",headers:{"Content-Length":String(buf.length),"X-Goog-Upload-Offset":"0","X-Goog-Upload-Command":"upload, finalize"},body:buf});
 const j=await d.json();if(!d.ok)throw new Error(j?.error?.message||"Gemini upload failed.");return j.file;
}
async function ask(file,prompt,key){
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt},{file_data:{mime_type:file.mimeType,file_uri:file.uri}}]}],generationConfig:{temperature:.2,maxOutputTokens:6000}})});
 const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||"Gemini generation failed.");return j?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("").trim()||"";
}
async function render(sourceUrl,plan,jobId){
 const external=(process.env.RENDER_WORKER_URL||"").replace(/\/$/,"");
 const base=external || ((process.env.APP_BASE_URL||"").replace(/\/$/,"")+"/api/render-worker");
 if(!base) throw new Error("APP_BASE_URL or RENDER_WORKER_URL is required.");
 const endpoint=external ? base+"/render" : base;
 const headers={"Content-Type":"application/json"};
 if(process.env.RENDER_WORKER_TOKEN) headers.Authorization="Bearer "+process.env.RENDER_WORKER_TOKEN;
 const r=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({
   source_url:sourceUrl,
   plan,
   output:{crf:20},
   output_pathname:"processed/"+jobId+".mp4"
 })});
 const data=await r.json().catch(()=>({}));
 if(!r.ok||!data.rendered) throw new Error(data.error||data.details||"Render worker failed.");
 return data;
}

export default async function handler(req,res){
 try{
  if(req.method!=="GET")return res.status(405).json({error:"GET only"});
  if(!ok(req))return res.status(401).json({error:"Unauthorized"});
  const key=process.env.GEMINI_API_KEY;if(!key)return res.status(500).json({error:"GEMINI_API_KEY is not configured."});
  const worker=(process.env.RENDER_WORKER_URL || ((process.env.APP_BASE_URL||"").replace(/\/$/,"")+"/api/render-worker")).replace(/\/$/,"");
  if(!worker)return res.status(500).json({error:"APP_BASE_URL is required when RENDER_WORKER_URL is not configured."});

  const bs=await list({prefix:"jobs/",limit:20});let item=null;
  for(const b of bs.blobs||[]){const j=await read(b.pathname).catch(()=>null);if(j?.status==="uploaded"){item={p:b.pathname,j};break;}}
  if(!item)return res.json({processed:0,reason:"no_uploaded_jobs"});

  const {p,j}=item;await write(p,{...j,status:"processing",stage:"ai_analysis",progress:10});
  const sourceUrl=await signedGet(j.source_pathname || j.source_url,30);
  const m=await fetch(sourceUrl);if(!m.ok)throw new Error("Could not fetch source media.");const buf=Buffer.from(await m.arrayBuffer());

  const f=await uploadGemini(buf,j.content_type||"video/mp4",j.original_name||"video",key);
  let state=String(f.state||"").toUpperCase();
  for(let i=0;i<24&&state!=="ACTIVE";i++){
    if(state==="FAILED")throw new Error("Gemini video processing failed.");
    await new Promise(r=>setTimeout(r,2500));
    const q=await fetch("https://generativelanguage.googleapis.com/v1beta/"+f.name+"?key="+encodeURIComponent(key));
    const x=await q.json();state=String(x.state||"").toUpperCase();f.uri=x.uri||f.uri;f.mimeType=x.mimeType||f.mimeType;
  }
  if(state!=="ACTIVE")throw new Error("Gemini video processing timed out.");

  const a=json(await ask(f,"Analyze this video. Return JSON with topic, hook, audience, key_moments, weaknesses, improvements, green_screen_detected, and platform_seo for youtube, instagram, facebook and tiktok. Each platform needs title, caption, description, keywords, hashtags and CTA. Never invent trends, search volume, analytics or unsupported timestamps.",key));
  await write(p,{...j,status:"processing",stage:"edit_plan",progress:40,analysis:a});

  const e=json(await ask(f,"Create a professional edit plan. Return JSON with project, hook, cuts, captions, overlays, audio, transitions, export and scene_compositing. Preserve faces, products and on-screen text. If green screen is detected, include realistic background requirements, perspective, lighting, edge cleanup, spill removal and contact shadow. Do not claim the video was rendered.",key));
  await write(p,{...j,status:"processing",stage:"rendering",progress:60,analysis:a,edit_plan:e});

  const rendered=await render(sourceUrl,e,j.job_id);
  const renderedJob={...j,status:"processed",stage:"rendered",progress:100,analysis:a,edit_plan:e,output_pathname:rendered.output_pathname,output_url:rendered.output_url,rendered_at:new Date().toISOString()};
  await write(p,renderedJob);

  // Optional automatic publishing: supply platform_connections on the job manifest.
  // Example: {youtube:{connection_id:"..."},tiktok:{connection_id:"..."},facebook:{connection_id:"...",page_id:"..."},instagram:{connection_id:"..."}}
  const queued=[];
  const connections=j.platform_connections||{};
  const base=(process.env.APP_BASE_URL||"").replace(/\/$/,"");
  if(base){
    for(const platform of ["youtube","instagram","facebook","tiktok"]){
      const c=connections[platform];
      if(!c?.connection_id) continue;
      const seo=a?.platform_seo?.[platform]||{};
      const r=await fetch(base+"/api/auto-publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        source_pathname:rendered.output_pathname,platform,connection_id:c.connection_id,page_id:c.page_id||null,
        title:seo.title||a.topic||j.original_name||"New video",caption:seo.caption||seo.description||"",
        scheduled_at:j.scheduled_at||new Date().toISOString(),priority_score:Number(j.priority_score||0)
      })});
      if(r.ok) queued.push(platform); else queued.push(platform+":queue_failed");
    }
  }
  return res.json({processed:1,job_id:j.job_id,stage:"rendered",output_pathname:rendered.output_pathname,queued_platforms:queued,note:"AI analysis, SEO, edit plan and physical FFmpeg rendering completed."});
 }catch(e){return res.status(500).json({error:e?.message||"Media processing failed."});}
}