import { loadTokenBundle } from "./token-vault.js";
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 const {connection_id,video_id}=req.body||{};
 if(!connection_id||!video_id)return res.status(400).json({error:"connection_id and video_id are required"});
 try{
  const token=await loadTokenBundle(connection_id);
  if(!token||token.provider!=="youtube")return res.status(404).json({error:"YouTube connection not found"});
  const url=`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(video_id)}`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token.access_token}`}});
  const data=await r.json(); return res.status(r.status).json({provider:"youtube",video_id,...data});
 }catch(e){return res.status(500).json({error:e.message});}
}