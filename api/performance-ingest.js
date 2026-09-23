import { put } from "@vercel/blob";

function normalize(p){
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  return {id:p.id??null,published_at:p.published_at??null,published_hour:p.published_hour??null,
    topic:p.topic??null,format:p.format??null,duration_seconds:p.duration_seconds==null?null:num(p.duration_seconds),
    views:num(p.views),reach:num(p.reach),likes:num(p.likes),comments:num(p.comments),shares:num(p.shares),saves:num(p.saves),
    watch_time_seconds:p.watch_time_seconds==null?null:num(p.watch_time_seconds),retention:p.retention==null?null:num(p.retention)};
}
function validKey(v){return String(v).replace(/[^a-z0-9_-]/gi,"_").slice(0,120);}
async function persist(platform,account_id,posts,audience_activity){
  const key="learning/"+validKey(platform)+"/"+validKey(account_id)+".json";
  let current={platform,account_id,posts:[],audience_activity:null,updated_at:null};
  try{
    const {get}=await import("@vercel/blob");
    const d=await get(key,{access:"private",useCache:false});
    if(d?.statusCode===200)current=await new Response(d.stream).json();
  }catch{}
  const byId=new Map((current.posts||[]).map(p=>[String(p.id),p]));
  for(const p of posts){const id=p.id!=null?String(p.id):crypto.randomUUID();byId.set(id,{...byId.get(id),...p,id});}
  const merged=[...byId.values()].sort((a,b)=>new Date(a.published_at||0)-new Date(b.published_at||0)).slice(-500);
  const learning={platform,account_id,posts:merged,audience_activity:audience_activity??current.audience_activity??null,updated_at:new Date().toISOString()};
  await put(key,JSON.stringify(learning),{access:"private",contentType:"application/json",allowOverwrite:true});
  return learning;
}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST only"});
  const {platform,account_id,posts=[],audience_activity=null}=req.body||{};
  if(!platform||!account_id)return res.status(400).json({error:"platform and account_id are required."});
  if(!Array.isArray(posts))return res.status(400).json({error:"posts must be an array."});
  const normalized=posts.map(normalize);
  try{
    const learning=await persist(platform,account_id,normalized,audience_activity);
    return res.status(202).json({accepted:true,persisted:true,platform,account_id,received_posts:normalized.length,learning_posts:learning.posts.length,received_audience_activity:Boolean(audience_activity)});
  }catch(error){
    return res.status(500).json({accepted:false,persisted:false,error:error?.message||"Learning persistence failed."});
  }
}