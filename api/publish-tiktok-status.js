import { loadTokenBundle } from "./token-vault.js";
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 const {connection_id,publish_id}=req.body||{};
 if(!connection_id||!publish_id)return res.status(400).json({error:"connection_id and publish_id are required"});
 try{
  const token=await loadTokenBundle(connection_id);
  if(!token||token.provider!=="tiktok")return res.status(404).json({error:"TikTok connection not found"});
  const r=await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/",{method:"POST",headers:{Authorization:`Bearer ${token.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({publish_id})});
  const data=await r.json(); return res.status(r.status).json({provider:"tiktok",publish_id,...data});
 }catch(e){return res.status(500).json({error:e.message});}
}