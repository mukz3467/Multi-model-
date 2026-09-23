import { get, put, list, issueSignedToken, presignUrl } from "@vercel/blob";
import { loadTokenBundle } from "./token-vault.js";

function cronAuthorized(req){const secret=process.env.CRON_SECRET;return Boolean(secret&&req.headers.authorization==="Bearer "+secret);}
async function readJob(pathname){const d=await get(pathname,{access:"private",useCache:false});if(!d||d.statusCode!==200)return null;return await new Response(d.stream).json();}
async function writeJob(pathname,job){await put(pathname,JSON.stringify({...job,updated_at:new Date().toISOString()}),{access:"private",contentType:"application/json",allowOverwrite:true});}
function terminal(job){return ["published","failed"].includes(job.status);}
async function tiktok(connection_id,publish_id){
  const token=await loadTokenBundle(connection_id);if(!token?.access_token)throw new Error("TikTok connection not found.");
  const r=await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/",{method:"POST",headers:{Authorization:"Bearer "+token.access_token,"Content-Type":"application/json"},body:JSON.stringify({publish_id})});
  const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"TikTok status request failed.");
  const s=d.data?.status||d.status;
  if(["PUBLISH_COMPLETE","SUCCESS","COMPLETED"].includes(s))return{status:"published",provider_status:s,data:d};
  if(["FAILED","ERROR","CANCELLED"].includes(s))return{status:"failed",provider_status:s,error:d.data?.fail_reason||d.data?.error||"TikTok publication failed.",data:d};
  return{status:"submitted",provider_status:s||"PROCESSING",data:d};
}
async function youtube(connection_id,video_id){
  const token=await loadTokenBundle(connection_id);if(!token?.access_token)throw new Error("YouTube connection not found.");
  const u="https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id="+encodeURIComponent(video_id);
  const r=await fetch(u,{headers:{Authorization:"Bearer "+token.access_token}});const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"YouTube status request failed.");
  const v=d.items?.[0];if(!v)return{status:"failed",error:"YouTube video was not found.",data:d};
  const p=v.processingDetails?.processingStatus,s=v.status?.uploadStatus;
  if(s==="rejected"||p==="failed")return{status:"failed",provider_status:p||s,error:v.processingDetails?.processingFailureReason||"YouTube processing failed.",data:d};
  if(s==="processed"||p==="succeeded")return{status:"published",provider_status:p||s,data:d};
  return{status:"submitted",provider_status:p||s||"processing",data:d};
}
async function meta(connection_id,job){
  const token=await loadTokenBundle(connection_id);const pages=token?.token?.pages||[];const page=pages.find(p=>!job.page_id||p.id===job.page_id);if(!page)throw new Error("Meta Page connection not found.");
  if(job.platform==="instagram"&&job.provider_response?.container_id){
    const igId=page.instagram_business_account;if(!igId)throw new Error("Instagram account is not linked.");
    const r=await fetch("https://graph.facebook.com/v23.0/"+encodeURIComponent(job.provider_response.container_id)+"?fields=status_code,status",{headers:{Authorization:"Bearer "+page.page_access_token}});
    const d=await r.json();if(!r.ok||d.error)throw new Error(d.error?.message||"Instagram status request failed.");
    if(d.status_code==="ERROR"||d.status==="ERROR")return{status:"failed",provider_status:d.status_code||d.status,error:"Instagram video processing failed.",data:d};
    if(d.status_code==="FINISHED"||d.status==="FINISHED"){
      const p=await fetch("https://graph.facebook.com/v23.0/"+encodeURIComponent(igId)+"/media_publish",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:job.provider_response.container_id,access_token:page.page_access_token})});
      const pd=await p.json();if(!p.ok||pd.error)throw new Error(pd.error?.message||"Instagram publish failed.");
      return{status:"published",provider_status:"PUBLISHED",data:{container:d,publish:pd}};
    }
    return{status:"submitted",provider_status:d.status_code||d.status||"PROCESSING",data:d};
  }
  if(job.platform==="facebook"&&job.provider_response?.video_id){
    const r=await fetch("https://graph.facebook.com/v23.0/"+encodeURIComponent(job.provider_response.video_id)+"?fields=id",{headers:{Authorization:"Bearer "+page.page_access_token}});
    const d=await r.json();if(!r.ok||d.error)return{status:"failed",error:d.error?.message||"Facebook video status failed.",data:d};
    return{status:"published",provider_status:"AVAILABLE",data:d};
  }
  return{status:"submitted",provider_status:"accepted"};
}
async function check(job){
  if(job.platform==="tiktok"&&job.provider_response?.publish_id)return tiktok(job.connection_id,job.provider_response.publish_id);
  if(job.platform==="youtube"&&job.provider_response?.video_id)return youtube(job.connection_id,job.provider_response.video_id);
  if((job.platform==="facebook"||job.platform==="instagram")&&job.provider_response)return meta(job.connection_id,job);
  return{status:"failed",error:"No provider publication ID is available for status tracking."};
}
export default async function handler(req,res){
  if(req.method!=="GET")return res.status(405).json({error:"GET only"});
  if(!cronAuthorized(req))return res.status(401).json({error:"Unauthorized cron request."});
  try{
    const listed=await list({prefix:"publish-queue/",limit:100});const results=[];
    for(const blob of(listed.blobs||[])){
      const job=await readJob(blob.pathname).catch(()=>null);
      if(!job||job.status!=="submitted")continue;
      try{
        const result=await check(job);
        if(result.status==="published")await writeJob(blob.pathname,{...job,status:"published",stage:"published",published_at:job.published_at||new Date().toISOString(),provider_status:result.provider_status,provider_status_data:result.data});
        else if(result.status==="failed")await writeJob(blob.pathname,{...job,status:"failed",stage:"failed",error:result.error||"Provider publication failed.",provider_status:result.provider_status,provider_status_data:result.data});
        else await writeJob(blob.pathname,{...job,status:"submitted",stage:"provider_processing",provider_status:result.provider_status,provider_status_data:result.data});
        results.push({id:job.id,platform:job.platform,status:result.status,provider_status:result.provider_status||null});
      }catch(error){results.push({id:job.id,platform:job.platform,status:"check_failed",error:error?.message||"Status check failed."});}
    }
    return res.status(200).json({checked:results.length,results});
  }catch(error){return res.status(500).json({error:error?.message||"Publish status tracker error."});}
}
