# Multi-Model AI Render Worker

This is the dedicated FFmpeg rendering service for the Multi-Model AI workspace.

## Why it exists

The main web app should handle UI, AI planning, authentication and job orchestration. Heavy video encoding should run in a worker with FFmpeg installed instead of depending on a serverless function's runtime.

Flow:

`Browser → AI edit plan → render worker → edited MP4`

## API

### Health

`GET /health`

### Render

`POST /render`

Body:

```json
{
  "videoBase64": "<base64>",
  "plan": {
    "cuts": [],
    "captions": []
  },
  "output": {
    "crf": 20
  }
}
```

Optional authentication:

Set `RENDER_WORKER_TOKEN` and send:

`Authorization: Bearer <token>`

## Production architecture

For large videos, replace direct base64 transport with object storage:

1. Web app creates a render job.
2. Input video is stored in object storage.
3. Worker downloads the input using a short-lived signed URL.
4. Worker renders to a temporary file.
5. Worker uploads the output.
6. Worker returns job status and output URL.
7. Web app shows progress and the final result.

The current worker keeps the first implementation simple and self-contained while providing a clean upgrade path to a queue + object-storage architecture.

## Important

This service requires FFmpeg. It is intentionally separate from the Vercel API layer so long-running video rendering does not depend on a serverless function.
