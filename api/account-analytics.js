import { loadTokenBundle } from "./token-vault.js";

async function youtubeAnalytics(token, startDate, endDate){
  const params=new URLSearchParams({
    ids:"channel==MINE",
    startDate,
    endDate,
    metrics:"views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost",
    dimensions:"day",
    sort:"day"
  });
  const r=await fetch("https://youtubeanalytics.googleapis.com/v2/reports?"+params,{
    headers:{Authorization:"Bearer "+token}
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.error?.message||"YouTube Analytics request failed.");
  return {kind:"youtube_analytics",columns:data.columnHeaders||[],rows:data.rows||[]};
}

async function youtubeVideos(token){
  const r=await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&maxResults=50",{
    headers:{Authorization:"Bearer "+token}
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.error?.message||"YouTube video list failed.");
  const ids=(data.items||[]).map(x=>x.id?.videoId).filter(Boolean).join(",");
  if(!ids) return [];
  const v=await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id="+encodeURIComponent(ids),{
    headers:{Authorization:"Bearer "+token}
  });
  const vd=await v.json();
  if(!v.ok) throw new Error(vd.error?.message||"YouTube video metrics failed.");
  return (vd.items||[]).map(x=>({
    id:x.id,title:x.snippet?.title||"",published_at:x.snippet?.publishedAt||"",
    views:Number(x.statistics?.viewCount||0),likes:Number(x.statistics?.likeCount||0),
    comments:Number(x.statistics?.commentCount||0)
  }));
}

async function tiktokVideos(token){
  const fields="id,title,create_time,view_count,like_count,comment_count,share_count";
  const r=await fetch("https://open.tiktokapis.com/v2/video/list/?fields="+encodeURIComponent(fields),{
    method:"POST",
    headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({max_count:20})
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.error?.message||"TikTok video list failed.");
  return (data.data?.videos||[]).map(x=>({
    id:x.id,title:x.title||"",published_at:x.create_time?new Date(Number(x.create_time)*1000).toISOString():"",
    views:Number(x.view_count||0),likes:Number(x.like_count||0),
    comments:Number(x.comment_count||0),shares:Number(x.share_count||0)
  }));
}

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"GET only"});
  const connectionId=String(req.query?.connection_id||"");
  if(!/^[a-f0-9]{32}$/.test(connectionId)) return res.status(400).json({error:"Valid connection_id is required."});
  try{
    const bundle=await loadTokenBundle(connectionId);
    if(!bundle) return res.status(404).json({error:"Connection not found."});
    const end=new Date(), start=new Date(end.getTime()-30*86400000);
    const iso=d=>d.toISOString().slice(0,10);
    if(bundle.provider==="youtube"){
      const [analytics,videos]=await Promise.all([
        youtubeAnalytics(bundle.token.access_token,iso(start),iso(end)),
        youtubeVideos(bundle.token.access_token)
      ]);
      return res.json({provider:"youtube",account_id:bundle.subject,period:{start:iso(start),end:iso(end)},analytics,videos,source:"YouTube APIs"});
    }
    if(bundle.provider==="tiktok"){
      const videos=await tiktokVideos(bundle.token.access_token);
      return res.json({provider:"tiktok",account_id:bundle.subject,videos,source:"TikTok Display API"});
    }
    return res.status(400).json({error:"Analytics connector not implemented for this provider."});
  }catch(error){
    return res.status(502).json({error:error.message});
  }
}
