import crypto from "node:crypto";
import { getProvider, getRedirectUri } from "./oauth-config.js";
function makeState(provider){
  const payload=Buffer.from(JSON.stringify({provider,nonce:crypto.randomBytes(18).toString("hex"),iat:Date.now()})).toString("base64url");
  const secret=process.env.OAUTH_STATE_SECRET;
  if(!secret) throw new Error("OAUTH_STATE_SECRET is not configured.");
  const sig=crypto.createHmac("sha256",secret).update(payload).digest("base64url");
  return payload+"."+sig;
}
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"GET only"});
  const name=String(req.query?.provider||"").toLowerCase(), p=getProvider(name);
  if(!p) return res.status(400).json({error:"Unsupported provider."});
  const clientId=process.env[p.clientIdEnv];
  if(!clientId) return res.status(500).json({error:p.clientIdEnv+" is not configured."});
  try{
    const q=new URLSearchParams({client_id:clientId,redirect_uri:getRedirectUri(name),response_type:"code",state:makeState(name)});
    q.set("scope",p.scopes.join(name==="youtube"?" ":name==="tiktok"?",":","));
    if(name==="youtube"){q.set("access_type","offline");q.set("prompt","consent");}
    return res.redirect(p.authorization+"?"+q.toString());
  }catch(e){return res.status(500).json({error:e.message});}
}
