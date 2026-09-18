import { getStore } from "@netlify/blobs";

const STORE_NAME = "user-programs";
const KEY = "list";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clean(str, max) {
  return (str || "").toString().trim().slice(0, max || 300);
}

function cleanArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x) => typeof x === "string").slice(0, 10).map((x) => x.slice(0, 30));
}

function newId() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export default async (req) => {
  const store = getStore(STORE_NAME);

  if (req.method === "GET") {
    const list = (await store.get(KEY, { type: "json" })) || [];
    return json(list);
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json({ error: "invalid_json" }, 400);
    }

    const title = clean(body.title, 300);
    const start = clean(body.start, 10);
    const end = clean(body.end, 10);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return json({ error: "missing_or_invalid_fields" }, 400);
    }

    const list = (await store.get(KEY, { type: "json" })) || [];
    const item = {
      id: newId(),
      source: "user",
      title,
      org: clean(body.org, 200),
      url: clean(body.url, 500),
      start,
      end,
      target: cleanArray(body.target),
      category: cleanArray(body.category),
      addedAt: new Date().toISOString(),
    };
    list.push(item);
    await store.setJSON(KEY, list);
    return json(item, 201);
  }

  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json({ error: "missing_id" }, 400);
    const list = (await store.get(KEY, { type: "json" })) || [];
    const next = list.filter((p) => p.id !== id);
    await store.setJSON(KEY, next);
    return json({ deleted: list.length - next.length });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/programs" };
