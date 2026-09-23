import { get, put, list, del, issueSignedToken, presignUrl } from "@vercel/blob";

const SETTINGS="settings/publishing-default.json";
function todayUtc(){return new Date().toISOString().slice(0,10);}
async function readSettings(){const d=await get(SETTINGS,{access:"private",useCache:false}).catch(()=>null);if(!d||d.statusCode!==200)return{daily_limit:2,published_today:0,date:todayUtc(),selection_mode:"ai_best"};const x=await new Response(d.stream).json();return x.date!==todayUtc()?{...x,published_today:0,date:todayUtc()}:x;}
async function writeSettings(x){await put(SETTINGS,JSON.stringify({...x,updated_at:new Date().toISOString()}),{access:"private",contentType:"application/json",allowOverwrite:true});}
async function readJob(pathname){const d=await get(pathname,{access:"private",useCache:false});if(!d||d.statusCode!==200)return null;return await new Response(d.stream).json();}
async function writeJob(pathname,job){await put(pathname,JSON.stringify({...job,updated_at:new Date().toISOString()}),{access:"private",contentType:"application/json",allowOverwrite:true});}
async function acquireLock(jobId){
  const pathname="publish-locks/"+jobId+".lock";
  try{await put(pathname,JSON.stringify({job_id:jobId,created_at:new Date().toISOString()}),{access:"private",contentType:"application/json",addRandomSuffix:false,allowOverwrite:false});return pathname;}
  catch(e){return null;}
}
async function releaseLock(pathname){if(!pathname)return;try{await del(pathname);}catch{}}
function transientError(error){
  const m=String(error?.message||"").toLowerCase();
  return /429|rate.?limit|too many|timeout|timed out|temporar|network|fetch failed|502|503|504|econn|socket|gateway/.test(m);
}
function cronAuthorized(req){const secret=process.env.CRON_SECRET;return Boolean(secret&&req.headers.authorization==="Bearer "+secret);}
async function signedMediaUrl(pathname){const token=await issueSignedToken({pathname,operations:["get"]});const {presignedUrl}=await presignUrl(token,{pathname,operation:"get",validUntil:Date.now()+60*60*1000});return presignedUrl;}
async function getLearning(base,job){
  if(!job.platform||!job.account_id)return null;
  const u=new URL(base.replace(/\/$/,"")+"/api/learning-memory");u.searchParams.set("platform",job.platform);u.searchParams.set("account_id",job.account_id);
  const r=await fetch(u);if(!r.ok)return null;const d=await r.json();return d.learning||null;
}
function patternsFromPosts(posts){
  const group=(key,bucketFn)=>{const m=new Map();for(const p of posts){const k=bucketFn?bucketFn(p):p[key]??"unknown";if(!m.has(k))m.set(k,[]);m.get(k).push(p);}return [...m].map(([k,rows])=>({[key]:k,posts:rows.length,avg_views:rows.reduce((s,x)=>s+Number(x.views||0),0)/rows.length,avg_retention:rows.reduce((s,x)=>s+Number(x.retention||0),0)/rows.length}));};
  return {topics:group("topic"),formats:group("format"),duration_buckets:group("duration_bucket",p=>p.duration_seconds==null?"unknown":Number(p.duration_seconds)<=30?"0-30s":Number(p.duration_seconds)<=60?"31-60s":Number(p.duration_seconds)<=180?"61-180s":"180s+")};
}
function candidateWindows(usedKeys){
  const out=[];const start=Date.now()+60*60*1000;const horizon=7*24*60*60*1000;
  for(let t=start;t<=Date.now()+horizon;t+=60*60*1000){
    const d=new Date(t),key=d.toISOString().slice(0,13);
    if(!usedKeys.has(key))out.push({hour:d.getUTCHours(),minutes_from_now:Math.max(0,Math.round((t-Date.now())/60000)),scheduled_at:d.toISOString()});
  }
  return out;
}
async function autoSchedule(base,jobs,dailyLimit){
  const groups=new Map();
  for(const item of jobs){const j=item.job;if(j.scheduled_at)continue;const key=[j.platform,j.account_id||"unknown",j.connection_id].join("|");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  const updates=[];
  for(const group of groups.values()){
    const learning=await getLearning(base,group[0].job);const posts=learning?.posts||[];
    const audience=learning?.audience_activity||null;
    let insights=null;
    if(posts.length){
      const r=await fetch(base.replace(/\/$/,"")+"/api/account-insights",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:{platform:group[0].job.platform,audience_activity:audience},posts})});
      if(r.ok)insights=await r.json();
    }
    const usedKeys=new Set();
    for(const item of jobs){if(item.job.status!=="queued"||!item.job.scheduled_at)continue;const d=new Date(item.job.scheduled_at);if(Number.isFinite(d.getTime()))usedKeys.add(d.toISOString().slice(0,13));}
    const dailyCounts=new Map();
    for(const item of jobs){if(item.job.status!=="queued"||!item.job.scheduled_at)continue;const day=new Date(item.job.scheduled_at).toISOString().slice(0,10);dailyCounts.set(day,(dailyCounts.get(day)||0)+1);}
    for(const item of group){
      const windows=candidateWindows(usedKeys).filter(w=>{const day=w.scheduled_at.slice(0,10);return (dailyCounts.get(day)||0)<Math.max(1,Number(dailyLimit||1));});
      if(!windows.length)continue;
      let chosen=windows[0];
      if(insights){
        const r=await fetch(base.replace(/\/$/,"")+"/api/schedule-decision",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:{topic:item.job.topic,format:item.job.format,duration_seconds:item.job.duration_seconds,platform:item.job.platform},candidate_windows:windows,context:{audience_activity:insights.audience_activity,historical_windows:insights.patterns.posting_hours,topic_performance:insights.patterns.topics,format_performance:insights.patterns.formats,duration_performance:insights.patterns.duration_buckets,recent_performance:{ratio:insights.summary.recent_vs_previous_views_ratio}}})});
        if(r.ok){const data=await r.json();if(data.decision)chosen=data.decision;}
      }
      await writeJob(item.pathname,{...item.job,scheduled_at:chosen.scheduled_at,schedule_source:insights?"account_evidence":"fallback",schedule_confidence:insights?"account_specific":"insufficient_evidence"});
      usedKeys.add(new Date(chosen.scheduled_at).toISOString().slice(0,13));const day=new Date(chosen.scheduled_at).toISOString().slice(0,10);dailyCounts.set(day,(dailyCounts.get(day)||0)+1);
      // Keep the in-memory queue in sync so a newly scheduled job can be published
      // during this same cron invocation instead of waiting for the next run.
      item.job.scheduled_at=chosen.scheduled_at;
      item.job.schedule_source=insights?"account_evidence":"fallback";
      item.job.schedule_confidence=insights?"account_specific":"insufficient_evidence";
      updates.push({id:item.job.id,scheduled_at:chosen.scheduled_at,source:insights?"account_evidence":"fallback"});
    }
  }
  return updates;
}
async function selectCandidates(base,candidates,mode,remaining){
  const fifo=()=>candidates.sort((a,b)=>Number(b.job.priority_score||0)-Number(a.job.priority_score||0)||new Date(a.job.created_at)-new Date(b.job.created_at)).slice(0,remaining);
  if(mode!=="ai_best")return fifo();
  const groups=new Map();for(const item of candidates){const j=item.job,key=[j.platform,j.account_id||"unknown",j.connection_id].join("|");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  const ranked=[];
  for(const group of groups.values()){const learning=await getLearning(base,group[0].job);if(!learning?.posts?.length){ranked.push(...group);continue;}const r=await fetch(base.replace(/\/$/,"")+"/api/content-selection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({candidates:group.map(x=>x.job),patterns:patternsFromPosts(learning.posts)})});if(!r.ok){ranked.push(...group);continue;}const data=await r.json(),byId=new Map(group.map(x=>[String(x.job.id),x]));for(const x of(Array.isArray(data.ranked)?data.ranked:[])){const item=byId.get(String(x.id));if(item)ranked.push(item);}for(const item of group)if(!ranked.includes(item))ranked.push(item);}
  return ranked.slice(0,remaining);
}
export default async function handler(req,res){
  try{
    if(req.method==="POST"){
      const b=req.body||{};if(!b.source_pathname||!b.platform||!b.connection_id)return res.status(400).json({error:"source_pathname, platform and connection_id are required."});if(!["youtube","tiktok","facebook","instagram"].includes(b.platform))return res.status(400).json({error:"Unsupported platform."});
      const id=cryptoRandom(),pathname="publish-queue/"+id+".json",now=new Date().toISOString();
      const job={id,status:"queued",source_pathname:String(b.source_pathname),platform:b.platform,connection_id:String(b.connection_id),account_id:b.account_id||null,page_id:b.page_id||null,title:b.title||"",caption:b.caption||"",topic:b.topic||null,format:b.format||null,duration_seconds:b.duration_seconds==null?null:Number(b.duration_seconds),performance_score:Number.isFinite(Number(b.performance_score))?Number(b.performance_score):null,scheduled_at:b.scheduled_at||null,schedule_source:b.scheduled_at?"explicit":"pending_ai",priority_score:Number.isFinite(Number(b.priority_score))?Number(b.priority_score):0,created_at:now,attempts:0};
      await writeJob(pathname,job);return res.status(202).json({job});
    }
    if(req.method!=="GET")return res.status(405).json({error:"GET or POST only"});if(!cronAuthorized(req))return res.status(401).json({error:"Unauthorized cron request."});
    const settings=await readSettings();
    const base=process.env.APP_BASE_URL;if(!base)throw new Error("APP_BASE_URL is not configured.");
    const listed=await list({prefix:"publish-queue/",limit:100}),all=[];for(const blob of(listed.blobs||[])){const job=await readJob(blob.pathname).catch(()=>null);if(job&&job.status==="queued")all.push({pathname:blob.pathname,job});}
    // Always plan future queue slots, even when today's publishing quota is already full.
    const scheduled=await autoSchedule(base,all,settings.daily_limit);
    const remaining=Math.max(0,Number(settings.daily_limit||2)-Number(settings.published_today||0));
    if(remaining<=0)return res.status(200).json({processed:0,reason:"daily_limit_reached",scheduled:scheduled.length,scheduled_jobs:scheduled,daily_limit:settings.daily_limit,published_today:settings.published_today,daily_remaining:0});
    const now=Date.now(),candidates=all.filter(x=>x.job.scheduled_at&&new Date(x.job.scheduled_at).getTime()<=now);
    const mode=settings.selection_mode==="ai_best"?"ai_best":"queue_order",selected=await selectCandidates(base,candidates,mode,remaining),results=[];
    for(const item of selected){const job=item.job;let lockPath=null;try{
      lockPath=await acquireLock(job.id);
      if(!lockPath){results.push({id:job.id,platform:job.platform,status:"skipped",reason:"publish_lock_active"});continue;}
      const attempt=Number(job.attempts||0)+1;
      await writeJob(item.pathname,{...job,status:"publishing",stage:"preparing",attempts:attempt,next_retry_at:null,last_error:null});const mediaUrl=await signedMediaUrl(job.source_pathname);const payload={platform:job.platform,connection_id:job.connection_id,video_url:mediaUrl,caption:job.caption,title:job.title,page_id:job.page_id};const r=await fetch(base.replace(/\/$/,"")+"/api/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw new Error(data.error||"Platform publish failed.");const finalStatus=data.published===true?"published":"submitted";await writeJob(item.pathname,{...job,status:finalStatus,stage:finalStatus,provider_response:data,published_at:finalStatus==="published"?new Date().toISOString():null});if(finalStatus==="published"||data.publish_id||data.video_id||data.media_id){settings.published_today=Number(settings.published_today||0)+1;await writeSettings(settings);}results.push({id:job.id,platform:job.platform,status:finalStatus,data});}catch(error){
      const message=error?.message||"Publish failed";
      const attempts=Number(job.attempts||0)+1;
      const retryable=transientError(error)&&attempts<4;
      if(retryable){
        const delay=Math.min(60,5*Math.pow(2,attempts-1));
        const next=new Date(Date.now()+delay*60*1000).toISOString();
        await writeJob(item.pathname,{...job,status:"queued",stage:"retry_wait",attempts,next_retry_at:next,last_error:message});
        results.push({id:job.id,platform:job.platform,status:"retry_scheduled",attempts,next_retry_at:next,error:message});
      }else{
        await writeJob(item.pathname,{...job,status:"failed",stage:"failed",attempts,last_error:message,error:message});
        results.push({id:job.id,platform:job.platform,status:"failed",attempts,error:message});
      }
    }finally{await releaseLock(lockPath);}}
    return res.status(200).json({processed:results.length,scheduled:scheduled.length,scheduled_jobs:scheduled,selection_mode:mode,selected_ids:selected.map(x=>x.job.id),results,daily_limit:settings.daily_limit,published_today:settings.published_today,daily_remaining:Math.max(0,Number(settings.daily_limit)-Number(settings.published_today||0))});
  }catch(error){return res.status(500).json({error:error?.message||"Auto-publish queue error."});}
}
function cryptoRandom(){return"q_"+Date.now()+"_"+Math.random().toString(36).slice(2,12);}
