import { loadTokenBundle } from "./token-vault.js";

async function graph(path, init={}) {
  const r=await fetch("https://graph.facebook.com/v23.0"+path,init);
  const data=await r.json();
  if(!r.ok||data.error) throw new Error(data.error?.message||"Meta Graph API request failed.");
  return data;
}

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"POST only"});
  try{
    const {connection_id,video_url,caption="",scheduled_at=null,title="",platform="facebook",page_id=null}=req.body||{};
    if(!connection_id||!video_url) return res.status(400).json({error:"connection_id and video_url are required."});
    if(!["facebook","instagram"].includes(platform)) return res.status(400).json({error:"platform must be facebook or instagram."});
    const bundle=await loadTokenBundle(connection_id);
    if(!bundle?.token?.pages?.length) return res.status(401).json({error:"Meta connection not found or no Page access."});
    const page=bundle.token.pages.find(p=>!page_id||p.id===page_id);
    if(!page) return res.status(400).json({error:"Requested Facebook Page is not connected."});

    if(platform==="facebook"){
      const params=new URLSearchParams({
        file_url:video_url,
        description:caption,
        access_token:page.page_access_token
      });
      if(title) params.set("title",title);
      if(scheduled_at){
        const ts=Math.floor(new Date(scheduled_at).getTime()/1000);
        if(!Number.isFinite(ts)) return res.status(400).json({error:"Invalid scheduled_at."});
        params.set("published","false");
        params.set("scheduled_publish_time",String(ts));
      }
      const data=await graph("/"+encodeURIComponent(page.id)+"/videos",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:params});
      return res.status(200).json({published:!scheduled_at,scheduled:Boolean(scheduled_at),platform:"facebook",page_id:page.id,video_id:data.id||null,api:data});
    }

    const igId=page.instagram_business_account;
    if(!igId) return res.status(400).json({error:"No Instagram professional account is linked to the selected Facebook Page."});

    const createParams=new URLSearchParams({
      media_type:"REELS",
      video_url,
      caption,
      share_to_feed:"true",
      access_token:page.page_access_token
    });
    const container=await graph("/"+encodeURIComponent(igId)+"/media",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:createParams});
    if(!container.id) throw new Error("Instagram media container was not created.");

    // Instagram processes video asynchronously. Polling is required before publish.
    let status=null;
    for(let i=0;i<8;i++){
      await new Promise(r=>setTimeout(r,2500));
      status=await graph("/"+encodeURIComponent(container.id)+"?fields=status_code,status",{headers:{Authorization:"Bearer "+page.page_access_token}});
      if(status.status_code==="FINISHED"||status.status==="FINISHED") break;
      if(status.status_code==="ERROR"||status.status==="ERROR") throw new Error("Instagram video processing failed.");
    }
    if(!(status?.status_code==="FINISHED"||status?.status==="FINISHED")){
      return res.status(202).json({published:false,processing:true,platform:"instagram",container_id:container.id,message:"Instagram accepted the video; processing is still in progress. Publish the container after it reaches FINISHED."});
    }
    const publish=await graph("/"+encodeURIComponent(igId)+"/media_publish",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:container.id,access_token:page.page_access_token})});
    return res.status(200).json({published:true,platform:"instagram",instagram_account_id:igId,container_id:container.id,media_id:publish.id||null,api:publish});
  }catch(error){
    return res.status(400).json({error:error?.message||"Meta publishing failed."});
  }
}
