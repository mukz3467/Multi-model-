export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 const {platform,posts=[]}=req.body||{};
 const scored=posts.filter(p=>Number.isFinite(Number(p.views))).map(p=>{const v=Number(p.views||0),e=Number(p.likes||0)+Number(p.comments||0)+Number(p.shares||0)+Number(p.saves||0);return {...p,engagement_rate:v?e/v:0};}).sort((a,b)=>b.engagement_rate-a.engagement_rate);
 const avg=scored.length?scored.reduce((s,p)=>s+p.engagement_rate,0)/scored.length:0;
 return res.json({platform,observations:{sample_size:scored.length,average_engagement_rate:avg,top_posts:scored.slice(0,5)},learning_signals:["Prefer topics and formats with consistently stronger observed engagement when sample size is sufficient.","Use historical posting-hour performance only when enough observations exist.","Do not infer causality from a single post or small sample."],evidence_only:true});
}