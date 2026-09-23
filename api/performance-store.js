import { put, get } from "@vercel/blob";
import { randomUUID } from "node:crypto";
const prefix="performance-v1/";
export async function savePerformance(record){
 const id=record.post_id||randomUUID(); const key=prefix+record.platform+"/"+id+".json";
 const existing=await get(key,{access:"private",useCache:false}); let history=[];
 if(existing) history=JSON.parse(await new Response(existing.stream).text()).history||[];
 history.push({...record,observed_at:new Date().toISOString()});
 await put(key,JSON.stringify({post_id:id,history}),{access:"private",addRandomSuffix:false,allowOverwrite:true});
 return {post_id:id,snapshots:history.length};
}
export default async function handler(req,res){if(req.method!=="POST")return res.status(405).json({error:"POST only"});try{return res.json(await savePerformance(req.body||{}));}catch(e){return res.status(500).json({error:e.message});}}