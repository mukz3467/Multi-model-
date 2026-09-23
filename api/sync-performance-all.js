import { list } from "@vercel/blob";

function auth(req){const s=process.env.CRON_SECRET;return Boolean(s&&req.headers.authorization==="Bearer "+s);}
async function read(path){const {get}=await import("@vercel/blob");const d=await get(path,{access:"private",useCache:false}).catch(()=>null);if(!d||d.statusCode!==200)return null;return await new Response(d.stream).json();}
export default async function handler(req,res){
  if(req.method!=="GET")return res.status(405).json({error:"GET only"});
  if(!auth(req))return res.status(401).json({error:"Unauthorized."});
  const base=process.env.APP_BASE_URL;if(!base)return res.status(500).json({error:"APP_BASE_URL is not configured."});
  try{
    const listed=await list({prefix:"oauth-vault/v1/",limit:100});
    const results=[];
    for(const blob of listed.blobs||[]){
      const id=blob.pathname.replace("oauth-vault/v1/","").replace(".json","");
      if(!/^[a-f0-9]{32}$/.test(id))continue;
      try{
        const status=await fetch(base.replace(/\/$/,"")+"/api/connection-status?connection_id="+encodeURIComponent(id),{headers:{Authorization:"Bearer "+process.env.CRON_SECRET}});
        if(!status.ok)continue;
        const meta=await status.json();
        if(!["youtube","tiktok","meta"].includes(meta.provider))continue;
        const r=await fetch(base.replace(/\/$/,"")+"/api/sync-performance?connection_id="+encodeURIComponent(id),{method:"POST",headers:{Authorization:"Bearer "+process.env.CRON_SECRET,"Content-Type":"application/json"}});
        const data=await r.json();results.push({connection_id:id,provider:meta.provider,ok:r.ok,data});
      }catch(error){results.push({connection_id:id,ok:false,error:error?.message||"sync failed"});}
    }
    return res.status(200).json({ok:true,connections_checked:results.length,results});
  }catch(error){return res.status(500).json({ok:false,error:error?.message||"Analytics sync-all failed."});}
}