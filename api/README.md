# API architecture

## Analysis
- `/api/analyze` — multimodal Gemini analysis.
- `/api/edit-plan` — structured edit decision list.

## Media intelligence
- `/api/account-insights` — computes account/content patterns from supplied analytics.
- `/api/performance-ingest` — normalizes performance metrics supplied by an authenticated connector.
- `/api/schedule-decision` — chooses among candidate windows using supplied account evidence.
- `/api/autopilot` — orchestrates account insights → schedule decision.

## Platform layer
- `/api/platform-connectors` — connector registry and explicit OAuth-required status.
- `/api/publish-job` — platform-neutral publishing job. It does not pretend to publish without an authenticated connector.

## Rendering
Heavy FFmpeg work belongs in `/render-worker`, not the Vercel API runtime.

## Autonomous loop

`media → analysis → edit plan → render → SEO → account insights → schedule decision → authenticated publish → performance ingestion → next recommendation`

Every intelligence endpoint separates supplied evidence from fallback heuristics and avoids fabricated analytics.
