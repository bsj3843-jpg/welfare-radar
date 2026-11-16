import { getStore } from "@netlify/blobs";
import { scrapeAll, todayKST } from "./scrape.mjs";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS_HEADERS },
  });
}

export function scrapedStore() {
  return getStore({ name: "scraped", consistency: "strong" });
}

export async function runRefresh(store) {
  const today = todayKST();
  await store.setJSON("state", { startedAt: new Date().toISOString(), finishedAt: null });

  const prev = (await store.get("data", { type: "json" })) || { items: [] };
  const known = {};
  for (const p of prev.items || []) known[p.url] = p;

  const { items, errors } = await scrapeAll(today, { known, budgetMs: 8000 });

  const merged = new Map();
  for (const p of prev.items || []) {
    if (p.end >= today) merged.set(p.url, p);
  }
  for (const src of Object.keys(items)) {
    for (const p of items[src]) merged.set(p.url, p);
  }

  const list = Array.from(merged.values());
  const counts = {};
  for (const p of list) counts[p.source] = (counts[p.source] || 0) + 1;

  const finishedAt = new Date().toISOString();
  const data = { updatedAt: finishedAt, date: today, items: list, counts, errors };
  await store.setJSON("data", data);
  await store.setJSON("state", { startedAt: finishedAt, finishedAt });
  return data;
}
