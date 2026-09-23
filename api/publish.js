export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 const {platform}=req.body||{};
 const routes={youtube:"/api/publish-youtube",tiktok:"/api/publish-tiktok",facebook:"/api/publish-meta",instagram:"/api/publish-meta"};
 if(!routes[platform])return res.status(400).json({error:"Publishing connector is not implemented for this platform yet.",platform});
 const base=process.env.APP_BASE_URL;
 if(!base)return res.status(500).json({error:"APP_BASE_URL is not configured"});
 try{
  const body={...req.body}; delete body.platform;
  const r=await fetch(base.replace(/\/$/,"")+routes[platform],{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json(); return res.status(r.status).json({platform,...data});
 }catch(e){return res.status(500).json({error:e.message});}
}