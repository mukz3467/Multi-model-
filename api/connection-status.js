import { loadTokenBundle } from "./token-vault.js";

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"GET only"});
  const id=String(req.query?.connection_id||"");
  if(!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({error:"Valid connection_id is required."});
  try{
    const bundle=await loadTokenBundle(id);
    if(!bundle) return res.status(404).json({connected:false});
    return res.json({
      connected:true,
      provider:bundle.provider,
      subject:bundle.subject,
      stored_at:bundle.stored_at
    });
  }catch(error){
    return res.status(500).json({error:error.message});
  }
}
