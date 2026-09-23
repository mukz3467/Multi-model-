import { loadTokenBundle } from "./token-vault.js";

async function ingest(base,provider,accountId,posts,audience_activity=null){
  if(!posts.length)return {persisted:false,received:0};
  const r=await fetch(base.replace(/\/$/,"")+"/api/performance-ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({platform:provider,account_id:accountId,posts,audience_activity})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||"Performance ingest failed.");
  return data;
}
async function youtube(token){
  const r=await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&maxResults=50",{headers:{Authorization:"Bearer "+token}});
  const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"YouTube video list failed.");
  const ids=(d.items||[]).map(x=>x.id?.videoId).filter(Boolean).join(",");if(!ids)return[];
  const v=await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id="+encodeURIComponent(ids),{headers:{Authorization:"Bearer "+token}});
  const vd=await v.json();if(!v.ok)throw new Error(vd.error?.message||"YouTube metrics failed.");
  return(vd.items||[]).map(x=>({id:x.id,published_at:x.snippet?.publishedAt||null,published_hour:x.snippet?.publishedAt?new Date(x.snippet.publishedAt).getUTCHours():null,topic:x.snippet?.categoryId||null,format:"video",duration_seconds:parseDuration(x.contentDetails?.duration),views:Number(x.statistics?.viewCount||0),likes:Number(x.statistics?.likeCount||0),comments:Number(x.statistics?.commentCount||0),shares:null,saves:null}));
}
function parseDuration(s){const m=String(s||"").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);return m?Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0):null;}
async function tiktok(token){
  const fields="id,title,create_time,view_count,like_count,comment_count,share_count";
  const r=await fetch("https://open.tiktokapis.com/v2/video/list/?fields="+encodeURIComponent(fields),{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({max_count:20})});
  const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"TikTok video list failed.");
  return(d.data?.videos||[]).map(x=>({id:x.id,published_at:x.create_time?new Date(Number(x.create_time)*1000).toISOString():null,published_hour:x.create_time?new Date(Number(x.create_time)*1000).getUTCHours():null,topic:null,format:"video",duration_seconds:null,views:Number(x.view_count||0),likes:Number(x.like_count||0),comments:Number(x.comment_count||0),shares:Number(x.share_count||0),saves:null}));
}
export default async function handler(req,res){
  if(req.method!=="POST"&&req.method!=="GET")return res.status(405).json({error:"GET or POST only"});
  const secret=process.env.CRON_SECRET;
  if(!secret||req.headers.authorization!=="Bearer "+secret)return res.status(401).json({error:"Unauthorized."});
  const connectionId=String(req.body?.connection_id||req.query?.connection_id||"");
  const base=process.env.APP_BASE_URL;
  if(!base)return res.status(500).json({error:"APP_BASE_URL is not configured."});
  if(!/^[a-f0-9]{32}$/.test(connectionId))return res.status(400).json({error:"Valid connection_id is required."});
  try{
    const bundle=await loadTokenBundle(connectionId);if(!bundle)return res.status(404).json({error:"Connection not found."});
    let posts=[];
    if(bundle.provider==="youtube")posts=await youtube(bundle.token.access_token);
    else if(bundle.provider==="tiktok")posts=await tiktok(bundle.token.access_token);
    else return res.status(400).json({error:"Automatic analytics sync is not implemented for this provider yet."});
    const result=await ingest(base,bundle.provider,bundle.subject,posts,null);
    return res.status(200).json({ok:true,provider:bundle.provider,account_id:bundle.subject,fetched_posts:posts.length,ingest:result});
  }catch(error){return res.status(502).json({ok:false,error:error?.message||"Analytics sync failed."});}
}