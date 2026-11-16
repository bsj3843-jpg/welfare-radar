import { CORS_HEADERS, json, scrapedStore, runRefresh } from "../lib/refresh.mjs";

const RUNNING_LOCK_MS = 45 * 1000;
const COOLDOWN_MS = 90 * 1000;

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const store = scrapedStore();
  const state = (await store.get("state", { type: "json" })) || {};
  const now = Date.now();

  if (state.startedAt && !state.finishedAt && now - Date.parse(state.startedAt) < RUNNING_LOCK_MS) {
    return json({ status: "running" }, 202);
  }
  if (state.finishedAt && now - Date.parse(state.finishedAt) < COOLDOWN_MS) {
    return json({ status: "fresh", updatedAt: state.finishedAt });
  }

  try {
    const data = await runRefresh(store);
    return json({ status: "done", updatedAt: data.updatedAt, counts: data.counts, errors: data.errors });
  } catch (e) {
    await store.setJSON("state", { startedAt: state.startedAt || null, finishedAt: state.finishedAt || null });
    return json({ status: "error", message: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/refresh" };
