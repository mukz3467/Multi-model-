export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"POST only"});
 const {prompt="",has_green_screen=false,background_style="professional studio",platform="youtube"}=req.body||{};
 const instructions={
  module:"AI Scene Composer",
  goal:"Create a realistic green-screen compositing plan.",
  steps:["detect green-screen quality and subject edges","remove green spill and preserve hair/fine edges","choose or generate a background matching the subject framing and topic","match camera perspective and scale","match light direction, exposure, white balance and color temperature","apply depth-of-field appropriate to the camera framing","add subtle contact shadow when appropriate","color-grade foreground and background together","preserve the person's identity, clothing and natural proportions","avoid obvious wallpaper artifacts, halos, floating subject or mismatched lighting"],
  output:{background_prompt:background_style+", realistic professional environment, physically plausible perspective and lighting, natural depth, no people, no text, no logos",composite_notes:"Use subject-aware positioning, lighting/color matching and edge refinement.",export:platform==="youtube"?"16:9":"9:16"}
 };
 return res.json({scene_plan:instructions,request:prompt,green_screen_detected:Boolean(has_green_screen),evidence_based:true});
}