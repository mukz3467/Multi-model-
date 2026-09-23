import { loadTokenBundle } from "./token-vault.js";
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 const {connection_id,video_base64,video_url,title="",privacy_level="SELF_ONLY",is_aigc=false}=req.body||{};
 if(!connection_id||(!video_base64&&!video_url))return res.status(400).json({error:"connection_id and video_base64 or video_url are required."});
 try{
  let sourceBase64=video_base64;
  if(!sourceBase64){const media=await fetch(video_url);if(!media.ok)return res.status(400).json({error:"Could not download source video URL."});sourceBase64=Buffer.from(await media.arrayBuffer()).toString("base64");}
  const bundle=await loadTokenBundle(connection_id);if(!bundle||bundle.provider!=="tiktok")return res.status(404).json({error:"TikTok connection not found."});
  const token=bundle.token.access_token,body=Buffer.from(sourceBase64,"base64");
  const creator=await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}});
  const creatorData=await creator.json();if(!creator.ok)return res.status(502).json({error:"TikTok creator info failed.",details:creatorData});
  const allowed=creatorData.data?.privacy_level_options||[],privacy=allowed.includes(privacy_level)?privacy_level:(allowed[0]||"SELF_ONLY");
  const chunk=10*1024*1024,total=Math.ceil(body.length/chunk);
  const init=await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({post_info:{title:String(title).slice(0,2200),privacy_level:privacy,is_aigc:Boolean(is_aigc)},source_info:{source:"FILE_UPLOAD",video_size:body.length,chunk_size:chunk,total_chunk_count:total}})});
  const data=await init.json();if(!init.ok||data.error?.code!=="ok")return res.status(502).json({error:"TikTok publish initialization failed.",details:data});
  const uploadUrl=data.data?.upload_url,publishId=data.data?.publish_id;if(!uploadUrl)return res.status(502).json({error:"TikTok did not return an upload URL."});
  for(let i=0;i<total;i++){const start=i*chunk,end=Math.min(body.length,start+chunk)-1,part=body.subarray(start,end+1);const u=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Type":"video/mp4","Content-Length":String(part.length),"Content-Range":"bytes "+start+"-"+end+"/"+body.length},body:part});if(!u.ok)return res.status(502).json({error:"TikTok media upload failed.",publish_id:publishId,chunk:i+1,details:await u.text()});}
  return res.status(202).json({published:false,submitted:true,provider:"tiktok",publish_id:publishId,privacy_level:privacy,message:"TikTok accepted the upload; processing status must be checked with publish-tiktok-status."});
 }catch(error){return res.status(502).json({error:error.message});}
}