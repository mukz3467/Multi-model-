function n(v,fallback=0){const x=Number(v);return Number.isFinite(x)?x:fallback;}
function normalized(value,values){const nums=values.map(n).filter(v=>v>0);if(!nums.length||!n(value))return 0;return Math.min(1,n(value)/Math.max(...nums));}
function rowFor(rows,key,value){return(rows||[]).find(x=>String(x[key])===String(value));}
function scoreWindow(window,context){
  const activity=context.audience_activity||{};
  const historical=context.historical_windows||[];
  const topic=context.topic_performance||[];
  const formats=context.format_performance||[];
  const durations=context.duration_performance||[];
  const recent=context.recent_performance||{};
  const activityValues=Object.values(activity).map(n);
  const histViews=historical.map(x=>x.avg_views);
  const topicRow=rowFor(topic,"topic",context.content?.topic);
  const formatRow=rowFor(formats,"format",context.content?.format);
  const duration=context.content?.duration_seconds==null?null:
    n(context.content.duration_seconds)<=30?"0-30s":n(context.content.duration_seconds)<=60?"31-60s":n(context.content.duration_seconds)<=180?"61-180s":"180s+";
  const durationRow=rowFor(durations,"duration_bucket",duration);
  const historicalRow=rowFor(historical,"hour",window.hour);
  const evidence=[];let score=0;
  const add=(type,value,values,weight)=>{if(value!=null&&values?.length){score+=normalized(value,values)*weight;evidence.push({type,value});}};
  add("audience_activity",activity[String(window.hour)],activityValues,35);
  add("historical_views",historicalRow?.avg_views,histViews,25);
  add("topic_performance",topicRow?.avg_views,topic.map(x=>x.avg_views),15);
  add("format_performance",formatRow?.avg_views,formats.map(x=>x.avg_views),10);
  add("duration_performance",durationRow?.avg_views,durations.map(x=>x.avg_views),10);
  if(recent.ratio!=null&&n(recent.ratio)>0){score+=Math.min(1,n(recent.ratio))*5;evidence.push({type:"recent_performance_ratio",value:recent.ratio});}
  const recencyPenalty=n(window.minutes_from_now)<30?5:0;
  score=Math.max(0,score-recencyPenalty);
  return{...window,score:Number(score.toFixed(3)),evidence};
}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST only"});
  const {content={},context={},candidate_windows=[]}=req.body||{};
  if(!Array.isArray(candidate_windows)||!candidate_windows.length)return res.status(400).json({error:"candidate_windows is required."});
  const ranked=candidate_windows.map(w=>scoreWindow(w,{...context,content})).sort((a,b)=>b.score-a.score);
  const evidenceCount=ranked[0]?.evidence?.length||0;
  const confidence=evidenceCount>=4?"high":evidenceCount>=2?"medium":evidenceCount===1?"low":"insufficient";
  const used={
    audience_activity:Boolean(context.audience_activity),
    historical_windows:Boolean(context.historical_windows?.length),
    topics:Boolean(context.topic_performance?.length),
    formats:Boolean(context.format_performance?.length),
    durations:Boolean(context.duration_performance?.length),
    recent_performance:context.recent_performance?.ratio!=null
  };
  return res.json({
    decision:ranked[0],alternatives:ranked.slice(1,5),
    basis:Object.values(used).some(Boolean)?"account-specific evidence":"fallback heuristic",
    confidence,evidence_count:evidenceCount,content:{topic:content.topic||null,format:content.format||null,duration_seconds:content.duration_seconds??null,platform:content.platform||null},
    learning:used,
    note:"Scores are evidence-based ranking signals from supplied account history, not predictions or guaranteed outcomes."
  });
}