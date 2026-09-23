import crypto from "node:crypto";
import { get, put } from "@vercel/blob";

const PREFIX = "oauth-vault/v1/";

function keyFromEnv(){
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if(!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(raw, "hex");
  if(key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte hex value.");
  return key;
}

function connectionId(provider, subject){
  return crypto.createHash("sha256").update(provider + ":" + subject).digest("hex").slice(0,32);
}

export async function saveTokenBundle({provider, subject, token}){
  const key=keyFromEnv();
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
  const plaintext=JSON.stringify({provider,subject,token,stored_at:new Date().toISOString()});
  const encrypted=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  const id=connectionId(provider,subject);
  const payload=JSON.stringify({
    v:1,
    alg:"aes-256-gcm",
    iv:iv.toString("base64url"),
    tag:tag.toString("base64url"),
    data:encrypted.toString("base64url")
  });
  await put(PREFIX+id+".json",payload,{access:"private",addRandomSuffix:false,allowOverwrite:true});
  return {connection_id:id};
}

export async function loadTokenBundle(id){
  const key=keyFromEnv();
  const result=await get(PREFIX+id+".json",{access:"private",useCache:false});
  if(!result) return null;
  const text=await new Response(result.stream).text();
  const box=JSON.parse(text);
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(box.iv,"base64url"));
  decipher.setAuthTag(Buffer.from(box.tag,"base64url"));
  const plaintext=Buffer.concat([decipher.update(Buffer.from(box.data,"base64url")),decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

export async function loadTokenBundle(id){
  const key=keyFromEnv();
  const result=await get(PREFIX+id+".json",{access:"private",useCache:false});
  if(!result) return null;
  const text=await new Response(result.stream).text();
  const box=JSON.parse(text);
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(box.iv,"base64url"));
  decipher.setAuthTag(Buffer.from(box.tag,"base64url"));
  const plaintext=Buffer.concat([decipher.update(Buffer.from(box.data,"base64url")),decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function publicConnectionId(provider,subject){
  return connectionId(provider,subject);
}
