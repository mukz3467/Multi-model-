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


## OAuth + secure token storage

- `/api/oauth-start` starts OAuth with a signed, expiring state.
- `/api/oauth-callback` exchanges the authorization code for YouTube/TikTok and stores the resulting token bundle encrypted in a private Vercel Blob object.
- `/api/connection-status` exposes connection metadata without returning OAuth tokens.
- `api/token-vault.js` uses AES-256-GCM before writing token data to private Blob storage.

Required environment variables:
- `APP_BASE_URL`
- `OAUTH_STATE_SECRET`
- `TOKEN_ENCRYPTION_KEY` — 32-byte hex key
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
- `META_APP_ID`, `META_APP_SECRET`
- `GEMINI_API_KEY`
- `CRON_SECRET`
- `BLOB_READ_WRITE_TOKEN`
- `RENDER_WORKER_TOKEN` (optional for protected rendering)
- `RENDER_WORKER_URL` (optional external FFmpeg worker; otherwise Vercel fallback is used)
- `FFMPEG_PRESET` and `RENDER_TIMEOUT_MS` (optional rendering tuning)

Storage setup:
1. Create a private Vercel Blob store and connect it to the project.
2. Ensure the deployment has Blob credentials/OIDC configured.
3. Generate a 32-byte encryption key locally and add it as `TOKEN_ENCRYPTION_KEY`.
4. Add the OAuth redirect URI for each provider as `APP_BASE_URL/api/oauth-callback?provider=...`.
5. Never commit OAuth secrets or token material to GitHub.

Google recommends server-side confidential OAuth flows with persistent refresh-token storage for offline access, and TikTok recommends server-side token management as well.

## Current connector scope

YouTube and TikTok now have token exchange + encrypted persistence + account identity lookup. Facebook/Instagram now use the Meta OAuth callback, discover connected Pages and linked Instagram professional accounts, and store Meta credentials encrypted in private Blob storage. Re-authorize existing connections after scope changes.
