# API architecture

## Analysis
- `/api/analyze` — multimodal Gemini analysis.
- `/api/edit-plan` — structured edit decision list.

## Media intelligence
- `/api/account-insights` — computes account/content patterns from supplied analytics.
- `/api/schedule-decision` — chooses among candidate windows using supplied account evidence.

## Publishing
- `/api/publish-job` — platform-neutral publishing job. It does not pretend to publish without an authenticated connector.

## Rendering
Heavy FFmpeg work belongs in `/render-worker`, not the Vercel API runtime.

## Autonomous loop

`media → analysis → edit plan → render → SEO → account insights → schedule decision → authenticated publish → performance ingestion → next recommendation`

Every intelligence endpoint separates supplied evidence from fallback heuristics and avoids fabricated analytics.
