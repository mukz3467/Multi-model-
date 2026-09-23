import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const body = await req.json();
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = clientPayload ? JSON.parse(clientPayload) : {};
        if (!pathname || !/\.(mp4|mov|webm|m4v|avi)$/i.test(pathname)) {
          throw new Error("Only supported video files can be uploaded.");
        }
        return {
          allowedContentTypes: ["video/mp4","video/quicktime","video/webm","video/x-m4v","video/x-msvideo"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            clientJobId: payload.clientJobId || null,
            originalName: payload.originalName || pathname,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log("media upload completed", blob.pathname, tokenPayload);
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Upload token generation failed." });
  }
}
