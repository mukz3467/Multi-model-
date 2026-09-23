import { get, put, list, issueSignedToken, presignUrl } from "@vercel/blob";

const SETTINGS="settings/publishing-default.json";
function todayUtc(){return new Date().toISOString().slice(0,10);}
async function readSettings(){const d=await get(SETTINGS,{access:"private",useCache:false}).catch(()=>null);if(!d||d.statusCode!==200)return{daily_limit:2,published_today:0,date:todayUtc(),selection_mode:"ai_best"};const x=await new Response(d.stream).json();return x.date!==todayUtc()?{...x,published_today:0,date:todayUtc()}:x;}
async function writeSettings(x){await put(SETTINGS,JSON.stringify({...x,updated_at:new Date().toISOString()}),{access:"private",contentType:"application/json",allowOverwrite:true});}
async function readJob(pathname){const d=await get(pathname,{access:"private",useCache:false});if(!d||d.statusCode!==200)return null;return await new Response(d.stream).json();}
async function writeJob(pathname,job){await put(pathname,JSON.stringify({...job,updated_at:new Date().toISOString()}),{access:"private",contentType:"application/json",allowOverwrite:true});}
function cronAuthorized(req){const secret=process.env.CRON_SECRET;return Boolean(secret&&req.headers.authorization==="Bearer "+secret);}
async function signedMediaUrl(pathname){const token=await issueSignedToken({pathname,operations:["get"]});const {presignedUrl}=await presignUrl(token,{pathname,operation:"get",validUntil:Date.now()+60*60*1000});return presignedUrl;}
async function getLearning(base,job){
  if(!job.platform||!job.account_id)return null;
  const u=new URL(base.replace(/\/$/,"")+"/api/learning-memory");u.searchParams.set("platform",job.platform);u.searchParams.set("account_id",job.account_id);
  const r=await fetch(u);if(!r.ok)return null;const d=await r.json();return d.learning||null;
}
async function selectCandidates(base,candidates,mode,remaining,jobHint){
  if(mode!=="ai_best")return candidates.sort((a,b)=>new Date(a.job.created_at)-new Date(b.job.created_at)).slice(0,remaining);
  const learning=await getLearning(base,jobHint);
  if(!learning?.posts?.length)return candidates.sort((a,b)=>Number(b.job.priority_score||0)-Number(a.job.priority_score||0)||new Date(a.job.created_at)-new Date(b.job.created_at)).slice(0,remaining);
  const patterns={topics:[],formats:[],duration_buckets:[]};
  const posts=learning.posts;
  const group=(key,bucketFn)=>{const m=new Map();for(const p of posts){const k=bucketFn?bucketFn(p):p[key]??"unknown";if(!m.has(k))m.set(k,[]);m.get(k).push(p);}return [...m].map(([k,rows])=>({[key]:k,posts:rows.length,avg_views:rows.reduce((s,x)=>s+Number(x.views||0),0)/rows.length,avg_retention:rows.reduce((s,x)=>s+Number(x.retention||0),0)/rows.length}));};
  patterns.topics=group("topic");patterns.formats=group("format");patterns.duration_buckets=group("duration_bucket",p=>p.duration_seconds==null?"unknown":Number(p.duration_seconds)<=30?"0-30s":Number(p.duration_seconds)<=60?"31-60s":Number(p.duration_seconds)<=180?"61-180s":"180s+");
  const r=await fetch(base.replace(/\/$/,"")+"/api/content-selection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({candidates:candidates.map(x=>x.job),patterns})});
  if(!r.ok)return candidates.sort((a,b)=>Number(b.job.priority_score||0)-Number(a.job.priority_score||0)||new Date(a.job.created_at)-new Date(b.job.created_at)).slice(0,remaining);
  const data=await r.json(),ranked=Array.isArray(data.ranked)?data.ranked:[];
  const byId=new Map(candidates.map(x=>[String(x.job.id),x]));
  return ranked.map(x=>byId.get(String(x.id))).filter(Boolean).slice(0,remaining);
}

export default async function handler(req,res){
  try{
    if(req.method==="POST"){
      const b=req.body||{};
      if(!b.source_pathname||!b.platform||!b.connection_id)return res.status(400).json({error:"source_pathname, platform and connection_id are required."});
      if(!["youtube","tiktok","facebook","instagram"].includes(b.platform))return res.status(400).json({error:"Unsupported platform."});
      const id=cryptoRandom(),pathname="publish-queue/"+id+".json",now=new Date().toISOString();
      const job={id,status:"queued",source_pathname:String(b.source_pathname),platform:b.platform,connection_id:String(b.connection_id),account_id:b.account_id||null,page_id:b.page_id||null,title:b.title||"",caption:b.caption||"",topic:b.topic||null,format:b.format||null,duration_seconds:b.duration_seconds==null?null:Number(b.duration_seconds),performance_score:Number.isFinite(Number(b.performance_score))?Number(b.performance_score):null,scheduled_at:b.scheduled_at||now,priority_score:Number.isFinite(Number(b.priority_score))?Number(b.priority_score):0,created_at:now,attempts:0};
      await writeJob(pathname,job);return res.status(202).json({job});
    }
    if(req.method!=="GET")return res.status(405).json({error:"GET or POST only"});
    if(!cronAuthorized(req))return res.status(401).json({error:"Unauthorized cron request."});
    const settings=await readSettings(),remaining=Math.max(0,Number(settings.daily_limit||2)-Number(settings.published_today||0));
    if(remaining<=0)return res.status(200).json({processed:0,reason:"daily_limit_reached",daily_limit:settings.daily_limit});
    const base=process.env.APP_BASE_URL;if(!base)throw new Error("APP_BASE_URL is not configured.");
    const now=Date.now(),listed=await list({prefix:"publish-queue/",limit:100}),candidates=[];
    for(const blob of(listed.blobs||[])){const job=await readJob(blob.pathname).catch(()=>null);if(!job||job.status!=="queued")continue;const due=job.scheduled_at?new Date(job.scheduled_at).getTime()<=now:true;if(due)candidates.push({pathname:blob.pathname,job});}
    const mode=settings.selection_mode==="ai_best"?"ai_best":"queue_order";
    const hint=candidates[0]?.job||{};
    const selected=await selectCandidates(base,candidates,mode,remaining,hint);
    const results=[];
    for(const item of selected){
      const job=item.job;
      try{
        await writeJob(item.pathname,{...job,status:"publishing",stage:"preparing",attempts:Number(job.attempts||0)+1});
        const mediaUrl=await signedMediaUrl(job.source_pathname);
        const payload={platform:job.platform,connection_id:job.connection_id,video_url:mediaUrl,caption:job.caption,title:job.title,page_id:job.page_id};
        const r=await fetch(base.replace(/\/$/,"")+"/api/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        const data=await r.json();if(!r.ok)throw new Error(data.error||"Platform publish failed.");
        const finalStatus=data.published===true?"published":"submitted";
        await writeJob(item.pathname,{...job,status:finalStatus,stage:finalStatus,provider_response:data,published_at:finalStatus==="published"?new Date().toISOString():null});
        if(finalStatus==="published"||data.publish_id||data.video_id||data.media_id){settings.published_today=Number(settings.published_today||0)+1;await writeSettings(settings);}
        results.push({id:job.id,platform:job.platform,status:finalStatus,data});
      }catch(error){await writeJob(item.pathname,{...job,status:"failed",stage:"failed",error:error?.message||"Publish failed"});results.push({id:job.id,platform:job.platform,status:"failed",error:error?.message||"Publish failed"});}
    }
    return res.status(200).json({processed:results.length,selection_mode:mode,selected_ids:selected.map(x=>x.job.id),results,daily_limit:settings.daily_limit,published_today:settings.published_today,daily_remaining:Math.max(0,Number(settings.daily_limit)-Number(settings.published_today||0))});
  }catch(error){return res.status(500).json({error:error?.message||"Auto-publish queue error."});}
}
function cryptoRandom(){return"q_"+Date.now()+"_"+Math.random().toString(36).slice(2,12);}
