import { get, put } from "@vercel/blob";

function key(platform, accountId) {
  const p = String(platform || "unknown").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  const a = String(accountId || "unknown").replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  return "learning/" + p + "/" + a + ".json";
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function normalizePost(p) {
  return { id:p.id ?? null, published_at:p.published_at ?? null, published_hour:p.published_hour ?? null,
    topic:p.topic ?? null, format:p.format ?? null, duration_seconds:p.duration_seconds == null ? null : num(p.duration_seconds),
    views:num(p.views), reach:num(p.reach), likes:num(p.likes), comments:num(p.comments), shares:num(p.shares), saves:num(p.saves),
    watch_time_seconds:p.watch_time_seconds == null ? null : num(p.watch_time_seconds), retention:p.retention == null ? null : num(p.retention),
    updated_at:new Date().toISOString() };
}
async function readLearning(k, platform, accountId) {
  try { const result=await get(k,{access:"private"}); if(!result||result.statusCode!==200) throw new Error("missing");
    return await new Response(result.stream).json();
  } catch { return {platform,account_id:accountId,posts:[],audience_activity:null,updated_at:null}; }
}
export default async function handler(req,res) {
  if(req.method!=="POST"&&req.method!=="GET") return res.status(405).json({error:"GET or POST only"});
  const platform=req.method==="GET"?req.query?.platform:req.body?.platform;
  const accountId=req.method==="GET"?req.query?.account_id:req.body?.account_id;
  if(!platform||!accountId) return res.status(400).json({error:"platform and account_id are required."});
  const k=key(platform,accountId);
  if(req.method==="GET"){const learning=await readLearning(k,platform,accountId);return res.status(200).json({ok:true,learning,posts_analyzed:learning.posts.length});}
  const body=req.body||{}, incoming=Array.isArray(body.posts)?body.posts.map(normalizePost):[], current=await readLearning(k,platform,accountId);
  const byId=new Map(current.posts.map(p=>[String(p.id),p]));
  for(const post of incoming){const id=post.id!=null?String(post.id):crypto.randomUUID();byId.set(id,{...byId.get(id),...post,id});}
  const posts=[...byId.values()].sort((a,b)=>new Date(a.published_at||0)-new Date(b.published_at||0)).slice(-500);
  const learning={platform,account_id:accountId,posts,audience_activity:body.audience_activity??current.audience_activity??null,updated_at:new Date().toISOString()};
  await put(k,JSON.stringify(learning),{access:"private",contentType:"application/json",allowOverwrite:true});
  return res.status(200).json({ok:true,stored_posts:posts.length,updated_at:learning.updated_at});
}