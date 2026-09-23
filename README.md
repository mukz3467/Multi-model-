# Multi-Model AI

A professional multimodal AI media workspace designed to analyze content, create editing plans, generate advanced platform SEO, analyze media performance, and make data-driven scheduling decisions.

## Core modules

### 1. AI Video Editor
The editor is designed as an AI-directed editing engine rather than a simple filter editor.

Pipeline:
- Inspect source video and audio
- Detect scenes, silence, repetition, subject changes and important moments
- Identify the strongest opening hook
- Build a cut/retention plan
- Generate captions and caption timing
- Recommend B-roll, overlays, zooms, transitions and sound cues
- Adapt framing for 9:16, 1:1 and 16:9
- Preserve important faces, products and on-screen text
- Produce an edit decision list for a later FFmpeg/rendering worker

Important: analysis must never claim that a video was physically edited until a rendering worker actually produces the output file.

### 2. Advanced SEO Intelligence
SEO is generated separately for each destination platform instead of copying one generic package.

The engine can consider:
- Video topic and transcript
- Hook and audience intent
- Platform-specific content format
- Search phrases and related concepts
- Title/caption structure
- Description
- Keywords
- Hashtags
- CTA
- Thumbnail/cover concept
- Content freshness and repetition

Outputs should distinguish observed evidence from recommendations and should not invent search-volume or trend metrics.

### 3. Media Manager Intelligence
The media manager is intended to operate as an analytics layer.

It can combine:
- Published-content history
- Views/reach
- Watch time/retention when available
- Engagement
- Shares/saves/comments
- Follower/subscriber growth
- Posting history
- Content topics
- Audience activity data supplied by connected platforms

It should identify patterns, content gaps, fatigue/repetition signals and test opportunities. Recommendations must be based on available account data rather than invented analytics.

### 4. Autonomous Scheduler
The scheduler should not use a hard-coded universal “best time”.

For each account and platform it should calculate candidate posting windows from:
- Audience activity data
- Historical performance by posting time
- Recent content performance
- Content type/topic
- Platform constraints
- Existing scheduled posts
- User-defined posting frequency
- Time zone

The scheduler should produce a ranked candidate schedule internally, explain the evidence behind the selected window, and re-evaluate future slots as new performance data arrives.

If account analytics are unavailable, the system must clearly label the schedule as a fallback based on general timing heuristics rather than pretending it has personalized evidence.

### 5. Autonomous workflow
Target workflow:

Raw video
→ multimodal analysis
→ content/retention analysis
→ AI edit decision list
→ render worker
→ platform-specific SEO
→ account/audience analysis
→ scheduling decision
→ publish through connected platform APIs
→ collect performance metrics
→ learn from results
→ improve future recommendations

## Architecture principles

- Provider-agnostic model layer
- Server-side API keys
- Modular workers
- Explicit evidence vs recommendation separation
- No fabricated analytics, trends, search volume or performance numbers
- Human approval can remain available before publishing
- Free-tier compatible development path where possible

## Current status

The repository currently contains the multimodal web interface and Gemini analysis endpoint. The next production layers are the FFmpeg rendering worker, platform API connectors, account analytics ingestion, persistent job storage, and the autonomous scheduling engine.
