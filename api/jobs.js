import { get, put } from "@vercel/blob";
import crypto from "node:crypto";

function id() { return crypto.randomUUID(); }\nasync function listJobs(limit=50){const {list}=await import("@vercel/blob");const out=[];const x=await list({prefix:"jobs/",limit});for(const b of x.blobs||[]){try{const d=await get(b.pathname,{access:"private",useCache:false});if(d&&d.statusCode===200)out.push(await new Response(d.stream).json())}catch{}}return out.sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0));}


export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const body = req.body || {};
      const jobId = body.job_id || id();
      const manifest = {
        job_id: jobId,
        status: body.status || "uploaded",
        original_name: String(body.original_name || "video"),
        content_type: String(body.content_type || "video/mp4"),
        size: Number(body.size || 0),
        source_url: String(body.source_url || ""),
        source_pathname: String(body.source_pathname || ""),
        created_at: body.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        platform: body.platform || null,
        prompt: body.prompt || "",
        progress: Number(body.progress || 100),
        stage: body.stage || "uploaded",
      };
      if (!manifest.source_pathname) return res.status(400).json({ error: "source_pathname is required." });
      await put(`jobs/${jobId}.json`, JSON.stringify(manifest), {
        access: "private",
        contentType: "application/json",
        allowOverwrite: true,
      });
      return res.status(200).json(manifest);
    }
    if (req.method === "GET") {
      const jobId = req.query?.id;
      if (!jobId || !/^[a-f0-9-]{20,80}$/i.test(jobId)) return res.status(400).json({ error: "Valid job id is required." });
      const result = await get(`jobs/${jobId}.json`, { access: "private" });
      if (!result || result.statusCode !== 200) return res.status(404).json({ error: "Job not found." });
      const text = await new Response(result.stream).text();
      return res.status(200).json(JSON.parse(text));
    }
    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Job store error." });
  }
}
