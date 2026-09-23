const providers = {
  youtube: { authorization: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scopes: ["https://www.googleapis.com/auth/youtube.upload","https://www.googleapis.com/auth/youtube.readonly","https://www.googleapis.com/auth/yt-analytics.readonly"], clientIdEnv: "YOUTUBE_CLIENT_ID", clientSecretEnv: "YOUTUBE_CLIENT_SECRET" },
  tiktok: { authorization: "https://www.tiktok.com/v2/auth/authorize/", token: "https://open.tiktokapis.com/v2/oauth/token/", scopes: ["user.info.basic","video.list","video.publish"], clientIdEnv: "TIKTOK_CLIENT_KEY", clientSecretEnv: "TIKTOK_CLIENT_SECRET" },
  facebook: { authorization: "https://www.facebook.com/v23.0/dialog/oauth", scopes: ["pages_show_list","pages_read_engagement","pages_manage_posts","instagram_basic","instagram_content_publish","pages_manage_metadata"], clientIdEnv: "META_APP_ID", clientSecretEnv: "META_APP_SECRET" },
  instagram: { authorization: "https://www.facebook.com/v23.0/dialog/oauth", scopes: ["pages_show_list","pages_read_engagement","pages_manage_posts","instagram_basic","instagram_content_publish","pages_manage_metadata"], clientIdEnv: "META_APP_ID", clientSecretEnv: "META_APP_SECRET" }
};
export function getProvider(name){ return providers[name] || null; }
export function getRedirectUri(provider){ const base=process.env.APP_BASE_URL; if(!base) throw new Error("APP_BASE_URL is not configured."); return base.replace(/\/$/,"")+"/api/oauth-callback?provider="+encodeURIComponent(provider); }
export { providers };
