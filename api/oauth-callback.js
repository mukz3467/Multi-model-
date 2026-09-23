import crypto from "node:crypto";
import { getProvider, getRedirectUri } from "./oauth-config.js";
import { saveTokenBundle } from "./token-vault.js";
function verifyState(state){
  const secret=process.env.OAUTH_STATE_SECRET;
  if(!secret||!state||!state.includes(".")) return null;
  const parts=state.split("."),expected=crypto.createHmac("sha256",secret).update(parts[0]).digest("base64url");
  if(parts[1]!==expected) return null;
  const payload=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));
  if(Date.now()-Number(payload.iat)>600000) return null;
  return payload;
}
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({error:"GET only"});
  const {code,state,error,error_description}=req.query||{};
  if(error) return res.status(400).json({error,error_description:error_description||"Authorization denied."});
  const verified=verifyState(state); if(!verified) return res.status(400).json({error:"Invalid or expired OAuth state."});
  const p=getProvider(verified.provider); if(!p) return res.status(400).json({error:"Unsupported provider."});
  const clientId=process.env[p.clientIdEnv],clientSecret=process.env[p.clientSecretEnv];
  if(!clientId||!clientSecret) return res.status(500).json({error:"OAuth credentials are not configured."});
  if(verified.provider==="youtube"||verified.provider==="tiktok"){
    const body=verified.provider==="youtube"
      ? {code:String(code||""),client_id:clientId,client_secret:clientSecret,redirect_uri:getRedirectUri(verified.provider),grant_type:"authorization_code"}
      : {client_key:clientId,client_secret:clientSecret,code:String(code||""),grant_type:"authorization_code",redirect_uri:getRedirectUri(verified.provider)};
    const r=await fetch(p.token,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(body)});
    const token=await r.json();
    if(!r.ok) return res.status(400).json({error:"Token exchange failed.",details:token});
    let subject=String(token.open_id||"");
    let account={};
    if(verified.provider==="youtube"){
      const profile=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true",{
        headers:{Authorization:"Bearer "+token.access_token}
      });
      const data=await profile.json();
      if(!profile.ok||!data.items?.[0]?.id) return res.status(400).json({error:"YouTube account lookup failed.",details:data});
      subject=data.items[0].id;
      account={
        id:subject,
        title:data.items[0].snippet?.title||"",
        description:data.items[0].snippet?.description||"",
        uploads_playlist_id:data.items[0].contentDetails?.relatedPlaylists?.uploads||null
      };
    } else {
      const profile=await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url",{
        headers:{Authorization:"Bearer "+token.access_token}
      });
      const data=await profile.json();
      if(!profile.ok||!data.data?.user?.open_id) return res.status(400).json({error:"TikTok account lookup failed.",details:data});
      subject=data.data.user.open_id;
      account=data.data.user;
    }
    const saved=await saveTokenBundle({provider:verified.provider,subject,token});
    const qs=new URLSearchParams({
      oauth:"connected",
      provider:verified.provider,
      connection_id:saved.connection_id
    });
    return res.redirect(302,"/?"+qs.toString());
  }
  return res.json({connected:true,provider:verified.provider,authorization_code_received:Boolean(code),next:"Provider-specific Meta token exchange and encrypted token storage remain required."});
}
