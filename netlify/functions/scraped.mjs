import { CORS_HEADERS, json, scrapedStore } from "../lib/refresh.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const data = await scrapedStore().get("data", { type: "json" });
  return json(data || { updatedAt: null, date: null, items: [], counts: {}, errors: {} });
};

export const config = { path: "/api/scraped" };
