import { loadTokenBundle } from "./token-vault.js";
export default async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({error:"POST only"});
 const {connection_id,video_base64,video_url,title="",description="",privacy_status="private",publish_at}=req.body||{};
 if(!connection_id||(!video_base64&&!video_url)) return res.status(400).json({error:"connection_id and video_base64 or video_url are required."});
 try{
  let sourceBase64=video_base64;
  if(!sourceBase64){const media=await fetch(video_url);if(!media.ok)return res.status(400).json({error:"Could not download source video URL."});sourceBase64=Buffer.from(await media.arrayBuffer()).toString("base64");}
  const bundle=await loadTokenBundle(connection_id);
  if(!bundle||bundle.provider!=="youtube") return res.status(404).json({error:"YouTube connection not found."});
  const token=bundle.token.access_token, body=Buffer.from(sourceBase64,"base64");
  const metadata={snippet:{title:String(title).slice(0,100),description:String(description).slice(0,5000)},status:{privacyStatus:publish_at?"private":privacy_status}};
  if(publish_at) metadata.status.publishAt=new Date(publish_at).toISOString();
  const init=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Type":"video/mp4","X-Upload-Content-Length":String(body.length)},body:JSON.stringify(metadata)});
  if(!init.ok)return res.status(502).json({error:"YouTube upload initialization failed.",details:await init.text()});
  const uploadUrl=init.headers.get("location");if(!uploadUrl)return res.status(502).json({error:"YouTube did not return an upload URL."});
  const uploaded=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Type":"video/mp4","Content-Length":String(body.length)},body});
  const data=await uploaded.json();if(!uploaded.ok)return res.status(502).json({error:"YouTube video upload failed.",details:data});
  return res.json({published:true,provider:"youtube",video_id:data.id||null,data});
 }catch(error){return res.status(502).json({error:error.message});}
}