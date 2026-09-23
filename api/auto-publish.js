import { get, put, list, issueSignedToken, presignUrl } from "@vercel/blob";
import { loadTokenBundle } from "./token-vault.js";

const SETTINGS="settings/publishing-default.json";

function todayUtc(){return new Date().toISOString().slice(0,10);}
async function readSettings(){
  const d=await get(SETTINGS,{access:"private",useCache:false}).catch(()=>null);
  if(!d||d.statusCode!==200) return {daily_limit:2,published_today:0,date:todayUtc(),selection_mode:"ai_best"};
  const x=await new Response(d.stream).json();
  if(x.date!==todayUtc()) return {...x,published_today:0,date:todayUtc()};
  return x;
}
async function writeSettings(x){
  await put(SETTINGS,JSON.stringify({...x,updated_at:new Date().toISOString()}),{access:"private",contentType:"application/json",allowOverwrite:true});
}
async function readJob(pathname){
  const d=await get(pathname,{access:"private",useCache:false});
  if(!d||d.statusCode!==200) return null;
  return await new Response(d.stream).json();
}
async function writeJob(pathname,job){
  await put(pathname,JSON.stringify({...job,updated_at:new Date().toISOString()}),{access:"private",contentType:"application/json",allowOverwrite:true});
}
function cronAuthorized(req){
  const secret=process.env.CRON_SECRET;
  if(!secret) return false;
  const h=req.headers.authorization||"";
  return h==="Bearer "+secret;
}
async function signedMediaUrl(pathname){
  const token=await issueSignedToken({pathname,operations:["get"]});
  const {presignedUrl}=await presignUrl(token,{pathname,operation:"get",validUntil:Date.now()+60*60*1000});
  return presignedUrl;
}

export default async function handler(req,res){
  try{
    if(req.method==="POST"){
      const b=req.body||{};
      if(!b.source_pathname||!b.platform||!b.connection_id) return res.status(400).json({error:"source_pathname, platform and connection_id are required."});
      if(!["youtube","tiktok","facebook","instagram"].includes(b.platform)) return res.status(400).json({error:"Unsupported platform."});
      const id=cryptoRandom();
      const pathname="publish-queue/"+id+".json";
      const job={id,status:"queued",source_pathname:String(b.source_pathname),platform:b.platform,connection_id:String(b.connection_id),page_id:b.page_id||null,title:b.title||"",caption:b.caption||"",scheduled_at:b.scheduled_at||new Date().toISOString(),priority_score:Number.isFinite(Number(b.priority_score))?Number(b.priority_score):0,created_at:new Date().toISOString(),attempts:0};
      await writeJob(pathname,job);
      return res.status(202).json({job});
    }
    if(req.method!=="GET") return res.status(405).json({error:"GET or POST only"});
    if(!cronAuthorized(req)) return res.status(401).json({error:"Unauthorized cron request."});

    const settings=await readSettings();
    const remaining=Math.max(0,Number(settings.daily_limit||2)-Number(settings.published_today||0));
    if(remaining<=0) return res.status(200).json({processed:0,reason:"daily_limit_reached",daily_limit:settings.daily_limit});

    const now=Date.now();
    const listed=await list({prefix:"publish-queue/",limit:100});
    const candidates=[];
    for(const blob of (listed.blobs||[])){
      const job=await readJob(blob.pathname).catch(()=>null);
      if(!job||job.status!=="queued") continue;
      const due=job.scheduled_at?new Date(job.scheduled_at).getTime()<=now:true;
      if(due) candidates.push({pathname:blob.pathname,job});
    }
    const mode=settings.selection_mode==="ai_best"?"ai_best":"queue_order";
    candidates.sort((a,b)=>mode==="ai_best" ? (Number(b.job.priority_score||0)-Number(a.job.priority_score||0) || new Date(a.job.created_at)-new Date(b.job.created_at)) : new Date(a.job.created_at)-new Date(b.job.created_at));

    const results=[];
    for(const item of candidates.slice(0,remaining)){
      const job=item.job;
      try{
        await writeJob(item.pathname,{...job,status:"publishing",stage:"preparing",attempts:Number(job.attempts||0)+1});
        const mediaUrl=await signedMediaUrl(job.source_pathname);
        let endpoint="/api/publish";
        const payload={platform:job.platform,connection_id:job.connection_id,video_url:mediaUrl,caption:job.caption,title:job.title,page_id:job.page_id};
        const base=process.env.APP_BASE_URL;
        if(!base) throw new Error("APP_BASE_URL is not configured.");
        const r=await fetch(base.replace(/\/$/,"")+endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        const data=await r.json();
        if(!r.ok) throw new Error(data.error||"Platform publish failed.");
        const finalStatus=data.published===true?"published":"submitted";
        await writeJob(item.pathname,{...job,status:finalStatus,stage:finalStatus,provider_response:data,published_at:finalStatus==="published"?new Date().toISOString():null});
        if(finalStatus==="published"||data.publish_id||data.video_id||data.media_id){
          settings.published_today=Number(settings.published_today||0)+1;
          await writeSettings(settings);
        }
        results.push({id:job.id,platform:job.platform,status:finalStatus,data});
      }catch(error){
        await writeJob(item.pathname,{...job,status:"failed",stage:"failed",error:error?.message||"Publish failed"});
        results.push({id:job.id,platform:job.platform,status:"failed",error:error?.message||"Publish failed"});
      }
    }
    return res.status(200).json({processed:results.length,results,daily_limit:settings.daily_limit,published_today:settings.published_today,daily_remaining:Math.max(0,Number(settings.daily_limit)-Number(settings.published_today||0))});
  }catch(error){return res.status(500).json({error:error?.message||"Auto-publish queue error."});}
}
function cryptoRandom(){return "q_"+Date.now()+"_"+Math.random().toString(36).slice(2,12);}
