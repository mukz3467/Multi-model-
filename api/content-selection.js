function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function norm(v,rows,key){const a=rows.map(x=>n(x[key])).filter(x=>x>0);return a.length&&n(v)?Math.min(1,n(v)/Math.max(...a)):0;}
function match(row,key,value){return value==null?null:row.find(x=>String(x[key])===String(value))||null;}

export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST only"});
  const {candidates=[],patterns={}}=req.body||{};
  if(!Array.isArray(candidates)||!candidates.length)return res.status(400).json({error:"candidates is required."});
  const topics=Array.isArray(patterns.topics)?patterns.topics:[];
  const formats=Array.isArray(patterns.formats)?patterns.formats:[];
  const durations=Array.isArray(patterns.duration_buckets)?patterns.duration_buckets:[];
  const ranked=candidates.map((c,index)=>{
    const topic=match(topics,"topic",c.topic), format=match(formats,"format",c.format);
    const duration= c.duration_seconds==null ? null :
      n(c.duration_seconds)<=30?"0-30s":n(c.duration_seconds)<=60?"31-60s":n(c.duration_seconds)<=180?"61-180s":"180s+";
    const durationRow=match(durations,"duration_bucket",duration);
    const evidence=[];
    let score=0;
    if(topic){score+=norm(topic.avg_views,topics,"avg_views")*45;evidence.push({type:"topic",value:topic.avg_views});}
    if(format){score+=norm(format.avg_views,formats,"avg_views")*30;evidence.push({type:"format",value:format.avg_views});}
    if(durationRow){score+=norm(durationRow.avg_views,durations,"avg_views")*15;evidence.push({type:"duration",value:durationRow.avg_views});}
    if(c.performance_score!=null){score+=Math.max(0,Math.min(10,n(c.performance_score)))*1;evidence.push({type:"candidate_score",value:c.performance_score});}
    const recency=c.published_at?Math.max(0,1-(Date.now()-new Date(c.published_at).getTime())/(1000*60*60*24*30)):1;
    score+=recency*9;
    return {...c,selection_score:Number(score.toFixed(3)),evidence,selection_confidence:evidence.length>=3?"high":evidence.length>=2?"medium":evidence.length?"low":"insufficient",queue_index:index};
  }).sort((a,b)=>b.selection_score-a.selection_score);
  return res.json({ok:true,ranked,model:"account-history-weighted",note:"Scores use supplied historical evidence only; they are ranking signals, not predicted outcomes."});
}