// Runs on a Korean-IP PC (Windows Task Scheduler, hourly). Scrapes the sources that block
// overseas servers (kaswc, bokji), writes data/korea.json and pushes it only when it changed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { scrapeAll, todayKST } = await import(pathToFileURL(join(root, "netlify", "lib", "scrape.mjs")).href);

const SOURCES = ["kaswc", "bokji"];
const FILE = join(root, "data", "korea.json");
const LOG_DIR = join(process.env.LOCALAPPDATA || root, "welfare-radar");
mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const line = new Date().toISOString() + " " + msg + "\n";
  try { appendFileSync(join(LOG_DIR, "local-scrape.log"), line); } catch (e) {}
  console.log(msg);
}

const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function gitRetry(args, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { return git(...args); } catch (e) {
      last = e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    }
  }
  throw last;
}

const normalize = (items) =>
  JSON.stringify(items.map((p) => { const { fetchedAt, ...rest } = p; return rest; }));

async function main() {
  try { gitRetry(["pull", "--rebase", "--autostash", "origin", "main"]); } catch (e) { log("pull failed: " + String(e.stderr || e.message).trim().slice(0, 200)); }

  const today = todayKST();
  const prev = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { items: [] };
  const known = {};
  for (const p of prev.items || []) known[p.url] = p;

  const { items, errors } = await scrapeAll(today, { known, budgetMs: 90000, only: SOURCES });

  const merged = new Map();
  for (const p of prev.items || []) if (p.end >= today && SOURCES.includes(p.source)) merged.set(p.url, p);
  for (const src of Object.keys(items)) for (const p of items[src]) merged.set(p.url, p);
  const list = Array.from(merged.values()).sort((a, b) => (a.source + a.url < b.source + b.url ? -1 : 1));

  const counts = {};
  for (const p of list) counts[p.source] = (counts[p.source] || 0) + 1;
  log("scraped counts=" + JSON.stringify(counts) + " errors=" + JSON.stringify(errors));

  if (existsSync(FILE) && normalize(list) === normalize(prev.items || [])) {
    log("no change");
  } else {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), date: today, items: list, errors }, null, 1) + "\n", "utf8");
    gitRetry(["add", "data/korea.json"]);
    gitRetry(["commit", "-m", "Update kaswc/bokji data (local scraper) - " + today, "-m", "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>", "--", "data/korea.json"]);
    log("committed");
  }

  try { gitRetry(["push", "origin", "main"]); log("pushed"); } catch (e) { log("push failed: " + String(e.stderr || e.message).trim().slice(0, 200)); }
}

main().catch((e) => { log("FATAL " + (e && e.stack ? e.stack : e)); process.exit(1); });
