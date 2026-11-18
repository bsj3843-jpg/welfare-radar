const UA = "Mozilla/5.0 (compatible; WelfareRadar/1.0; +https://snwc.netlify.app)";
const FAR_FUTURE = "2099-12-31";

const pad = (n) => String(n).padStart(2, "0");
const toISO = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);

export function todayKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function get(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 7000);
  try {
    const res = await fetch(url, {
      ...(init || {}),
      headers: { "user-agent": UA, ...((init && init.headers) || {}) },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(url + " -> HTTP " + res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, limit, fn, errors) {
  const out = new Array(items.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      try {
        out[k] = await fn(items[k]);
      } catch (e) {
        out[k] = null;
        if (errors) errors.push(String((e && e.message) || e));
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&hellip;/g, "…")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&[lr]squo;/g, "'")
    .replace(/&[lr]dquo;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const clean = (s) => decodeEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function htmlToText(h) {
  return clean(
    h
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
  );
}

/* ---------- keyword tagging ---------- */
const TARGET_RULES = [
  ["아동", /아동|어린이|초등|유아|영아|지역아동센터|그룹홈|공동생활가정|보육|키즈|꿈나무/],
  ["청소년", /청소년|중학생|고등학생|중·고|중고등|학교\s?밖|10대/],
  ["청년", /청년|자립준비|보호종료|대학생|사회초년|2030|20대|30대/],
  ["노인", /노인|어르신|독거|경로|시니어|실버|치매|홀몸|노년/],
  ["장애인", /장애/],
  ["한부모", /한부모|미혼모|미혼부|조손|부자가정|모자가정/],
  ["다문화", /다문화|이주배경|이민|외국인|북한이탈|새터민/],
  ["위기가정", /위기가정|위기가구|위기의\s?순간|통합위기|긴급복지/],
];

const CATEGORY_RULES = [
  ["생계비", /생계|생활비|양육비|생활안정|급여|연금|수당/],
  ["의료비", /의료|치료|수술|병원|진료|건강검진|재활|검진|치과|안경/],
  ["주거비", /주거|월세|임대|집수리|보증금|주택|전세|환경개선|도배|장판/],
  ["교육비", /교육|장학|학습|학업|멘토링|진학|교재|문해|리터러시|코딩|스쿨|어학|강좌|배움/],
  ["자립지원", /자립|취업|창업|일자리|직업|재무|금융|자산형성|저축/],
  ["심리정서지원", /심리|정서|상담|치유|마음|우울|자살|정신건강|트라우마|힐링|명상/],
  ["위기긴급지원", /위기|긴급|재난|화재|학대|폭력|응급|피해/],
  ["물품지원", /물품|김장|김치|쌀|식품|식료|도시락|밀키트|기기|노트북|후원품|의류|가전|현물|키트|난방|연탄|방한|선물|꾸러미|간식|문구|가방|도서/],
];

export function classify(text) {
  const target = TARGET_RULES.filter((r) => r[1].test(text)).map((r) => r[0]);
  const category = CATEGORY_RULES.filter((r) => r[1].test(text)).map((r) => r[0]).slice(0, 2);
  return { target, category: category.length ? category : ["기타"] };
}

/* ---------- date helpers ---------- */
function parseRange(str, postedISO) {
  const re = /(?:(\d{4})\s*[년.\-/]\s*)?(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?/g;
  const found = [];
  let year = postedISO ? Number(postedISO.slice(0, 4)) : Number(todayKST().slice(0, 4));
  let prev = null;
  let m;
  while ((m = re.exec(str))) {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    let y = m[1] ? Number(m[1]) : year;
    let iso = toISO(y, mo, d);
    if (!m[1] && prev && iso < prev) {
      y += 1;
      iso = toISO(y, mo, d);
    }
    year = y;
    prev = iso;
    found.push(iso);
  }
  const open = /상시|소진|수시|연중|선착순/.test(str);
  if (found.length === 0) {
    if (open) return { start: postedISO || todayKST(), end: FAR_FUTURE };
    return null;
  }
  if (found.length === 1) {
    if (open) return { start: found[0], end: FAR_FUTURE };
    const end = found[0];
    const start = postedISO && postedISO <= end ? postedISO : end;
    return { start, end };
  }
  const start = found[0];
  const end = found[found.length - 1];
  if (start > end) return { start: end, end: start };
  return { start, end };
}

/* ---------- Source A: kpang ---------- */
function parseKpangDetail(url, html) {
  const text = htmlToText(html);
  const i = text.indexOf("사업 개요");
  if (i < 0) return null;
  const seg = text.slice(i, i + 1100);

  const titleM = seg.match(/사업명\s+(.+?)\s+주관기관\s/);
  const orgM = seg.match(/주관기관\s+(.+?)\s+(?:게시일|신청\s?기간|모집)/);
  const postedM = seg.match(/게시일\s+(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  const periodM = seg.match(
    /신청\s?기간\s+(.+?)\s+(?:모집\s?상태|지원\s?대상|신청\s?대상|지원\s?한도|지원\s?내용|지원\s?형태|신청\s?방법|선정\s?규모|문의|접수\s?방법)/
  );
  const statusM = seg.match(/모집\s?상태\s+(\S+(?:\s\S+)?)/);
  if (!periodM) return null;
  if (statusM && /마감|종료/.test(statusM[1])) return null;

  const posted = postedM ? toISO(postedM[1], Number(postedM[2]), Number(postedM[3])) : null;
  const range = parseRange(periodM[1], posted);
  if (!range) return null;

  let title = titleM ? titleM[1] : "";
  if (!title) {
    const t = html.match(/<title>([^<]*)<\/title>/);
    title = t ? clean(t[1]).replace(/\s*[-–|]\s*정보광장\s*$/, "") : "";
  }
  title = title.replace(/^\[전국\]\s*/, "").trim();
  if (!title) return null;

  const tagText = title + " " + seg.slice(0, 700);
  const tags = classify(tagText);
  return {
    source: "kpang",
    title,
    org: orgM ? orgM[1].trim() : "",
    url,
    start: range.start,
    end: range.end,
    target: tags.target,
    category: tags.category,
  };
}

const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

async function scrapeKpang(today, ctx) {
  const listHtml = await (await get("https://kpang.kr/donation/", null, Math.min(7000, ctx.timeLeft()))).text();
  const links = [
    ...new Set(
      [...listHtml.matchAll(/<h3 class="elementor-post__title">\s*<a href="(https:\/\/kpang\.kr\/\d{8,12}\/?)"/g)].map((m) => m[1])
    ),
  ].slice(0, 30);
  if (!links.length) throw new Error("kpang: no posts found. len=" + listHtml.length + " " + clean(listHtml).slice(0, 140));
  const items = await pool(links, 10, async (url) => {
    const known = ctx.known[url];
    const fresh = known && known.fetchedAt && daysBetween(today, known.fetchedAt) < 2;
    if (fresh) return known;
    if (ctx.timeLeft() < 1500) return known || null;
    const html = await (await get(url, null, Math.min(6000, ctx.timeLeft()))).text();
    const item = parseKpangDetail(url, html);
    if (item) item.fetchedAt = today;
    return item;
  });
  return items.filter((p) => p && p.end >= today);
}

/* ---------- Source B: holt ---------- */
const HOLT_BIZ = {
  양육생계지원: "생계비",
  위기지원: "위기긴급지원",
  주거지원: "주거비",
  자립지원: "자립지원",
  심리정서지원: "심리정서지원",
  의료지원: "의료비",
  교육지원: "교육비",
};

function holtTargets(s) {
  const out = [];
  const t = String(s || "");
  if (/아동/.test(t)) out.push("아동");
  if (/청소년/.test(t)) out.push("청소년");
  if (/청년/.test(t)) out.push("청년");
  if (/노인|어르신/.test(t)) out.push("노인");
  if (/장애/.test(t)) out.push("장애인");
  if (/한부모/.test(t)) out.push("한부모");
  if (/다문화/.test(t)) out.push("다문화");
  return out;
}

const dotToISO = (s) => String(s || "").replace(/\./g, "-");

async function scrapeHolt(today, ctx) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const body = new URLSearchParams({
      action: "get_posts",
      posts_per_page: "30",
      post_type: "request_support",
      paged: String(page),
      meta_key: "request_support_end_date",
      orderby: "meta_value",
      order: "DESC",
    });
    const res = await get("https://love.holt.or.kr/wp-admin/admin-ajax.php", { method: "POST", body }, Math.min(7000, ctx.timeLeft()));
    const j = await res.json();
    const posts = Array.isArray(j.current_post) ? j.current_post : [];
    let allOpen = posts.length > 0;
    for (const p of posts) {
      const end = dotToISO(p.custom_request_support_end_date);
      const start = dotToISO(p.custom_request_support_start_date) || end;
      const status = p.custom_request_support_time;
      const open = status === "신청가능" || (!status || status === "해당없음" ? end >= today : false);
      if (end < today) allOpen = false;
      if (!open || !end) continue;
      const title = clean(p.post_title);
      const tags = classify(title);
      const siteTarget = holtTargets(p.custom_request_support_target);
      const siteBiz = HOLT_BIZ[p.custom_request_support_business];
      out.push({
        source: "holt",
        title,
        org: "홀트아동복지회",
        url: p.permalink,
        start,
        end,
        target: siteTarget.length ? siteTarget : tags.target,
        category: siteBiz ? [siteBiz] : tags.category,
      });
    }
    if (!allOpen) break;
  }
  return out;
}

/* ---------- Source C: kaswc ---------- */
const KASWC_BASE = "https://share.kaswc.or.kr/info2";

function kaswcField(block, label) {
  const m = block.match(new RegExp(label + "</div>\\s*<div[^>]*>([\\s\\S]*?)</div>"));
  return m ? clean(m[1]) : "";
}

function parseKaswcList(html) {
  return html
    .split('<li class="clear">')
    .slice(1)
    .map((block) => {
      const h3 = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      const href = block.match(/class="hx"\s+href="\/info2\/(\d+)/);
      return {
        id: href ? href[1] : null,
        title: h3 ? clean(h3[1]) : "",
        org: kaswcField(block, "주최기관"),
        start: kaswcField(block, "신청시작"),
        end: kaswcField(block, "신청종료"),
      };
    })
    .filter((x) => x.id && /^\d{4}-\d{2}-\d{2}$/.test(x.start) && /^\d{4}-\d{2}-\d{2}$/.test(x.end));
}

function stripOrgPrefix(title, org) {
  if (org && title.startsWith(org + " ")) return title.slice(org.length + 1).trim();
  return title;
}

async function scrapeKaswc(today, ctx) {
  const pages = [1, 2, 3, 4, 5, 6];
  const pageErrors = [];
  let firstSnippet = "";
  const lists = await pool(
    pages,
    6,
    async (n) => {
      const url = n === 1 ? KASWC_BASE : KASWC_BASE + "/page/" + n;
      const html = await (await get(url, null, Math.min(7000, ctx.timeLeft()))).text();
      const parsed = parseKaswcList(html);
      if (!parsed.length && !firstSnippet) firstSnippet = "len=" + html.length + " " + clean(html).slice(0, 140);
      return parsed;
    },
    pageErrors
  );
  if (!lists.some((l) => l && l.length)) {
    throw new Error("kaswc: no items parsed. " + (pageErrors[0] || firstSnippet || "unknown"));
  }
  const seen = new Set();
  const open = [];
  for (const list of lists) {
    for (const it of list || []) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      if (it.start <= today && today <= it.end) open.push(it);
    }
  }
  const full = await pool(open, 10, async (it) => {
    if (!/(\.\.\.|…)$/.test(it.title)) return it.title;
    const known = ctx.known[KASWC_BASE + "/" + it.id];
    if (known && known.title) return known.title;
    if (ctx.timeLeft() < 1500) return it.title;
    const html = await (await get(KASWC_BASE + "/" + it.id, null, Math.min(6000, ctx.timeLeft()))).text();
    const h1 = html.match(/<h1 class="np_25px">[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/);
    return h1 ? clean(h1[1]) : it.title;
  });
  return open.map((it, i) => {
    const title = stripOrgPrefix(full[i] || it.title, it.org);
    const tags = classify(title + " " + it.org);
    return {
      source: "kaswc",
      title,
      org: it.org,
      url: KASWC_BASE + "/" + it.id,
      start: it.start,
      end: it.end,
      target: tags.target,
      category: tags.category,
    };
  });
}

/* ---------- Source D: saswc (서울시사회복지관협회) ---------- */
const SASWC_BASE = "https://www.saswc.org/support";
const SASWC_EXCLUDE = /포럼|토론회|세미나|학술|심포지엄|컨퍼런스|콘퍼런스|워크숍|워크샵|설명회|행사|교육|강좌|강사|양성|특강|공연|티켓|채용|구인|간담회|공청회|연수/;
const SASWC_INCLUDE = /지원|공모|모집|후원|장학|신청|제안/;

function htmlToLines(h) {
  return decodeEntities(
    h
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|li|div|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const PERIOD_LABEL = /(신청|접수|모집|공모|제출)\s?(기간|기한|일정|마감)\s*[:：]?/;

function findPeriod(lines, posted) {
  for (const l of lines) {
    if (!PERIOD_LABEL.test(l) || l.length > 200) continue;
    const r = parseRange(l.slice(l.search(PERIOD_LABEL)).replace(PERIOD_LABEL, ""), posted);
    if (r) return r;
  }
  return null;
}

function parseSaswcList(html) {
  return html
    .split("<tr")
    .slice(1)
    .map((r) => {
      if (/class="notice"/.test(r)) return null;
      const a = r.match(/<a href="\/support\/(\d+)"[^>]*>([\s\S]*?)<\/a>/);
      const t = r.match(/<td class="time"[^>]*>(\d{4})\.(\d{2})\.(\d{2})<\/td>/);
      if (!a || !t) return null;
      return { id: a[1], title: clean(a[2]), posted: t[1] + "-" + t[2] + "-" + t[3] };
    })
    .filter(Boolean);
}

function parseSaswcDetail(it, html) {
  const m = html.match(/<article>([\s\S]*?)<!--AfterDocument/);
  if (!m) return null;
  const lines = htmlToLines(m[1]);
  const range = findPeriod(lines, it.posted);
  if (!range) return null;

  const tm = it.title.match(/^\[([^\]]+)\]\s*(.*)$/);
  const org = tm ? tm[1].trim() : "";
  const title = (tm ? tm[2] : it.title).trim();
  if (!title) return null;
  const tags = classify(title + " " + lines.join(" ").slice(0, 600));
  return {
    source: "saswc",
    title,
    org,
    url: SASWC_BASE + "/" + it.id,
    start: range.start,
    end: range.end,
    target: tags.target,
    category: tags.category,
  };
}

async function scrapeSaswc(today, ctx) {
  const pageErrors = [];
  const lists = await pool(
    [1, 2, 3],
    3,
    async (n) => {
      const url = n === 1 ? SASWC_BASE : SASWC_BASE + "?page=" + n;
      return parseSaswcList(await (await get(url, null, Math.min(7000, ctx.timeLeft()))).text());
    },
    pageErrors
  );
  if (!lists.some((l) => l && l.length)) {
    throw new Error("saswc: no items parsed. " + (pageErrors[0] || "unknown"));
  }
  const seen = new Set();
  const cands = [];
  for (const list of lists) {
    for (const it of list || []) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      if (SASWC_INCLUDE.test(it.title) && !SASWC_EXCLUDE.test(it.title)) cands.push(it);
    }
  }
  const items = await pool(cands, 10, async (it) => {
    const url = SASWC_BASE + "/" + it.id;
    const known = ctx.known[url];
    if (known && known.fetchedAt && daysBetween(today, known.fetchedAt) < 2) return known;
    if (ctx.timeLeft() < 1500) return known || null;
    const html = await (await get(url, null, Math.min(6000, ctx.timeLeft()))).text();
    const item = parseSaswcDetail(it, html);
    if (item) item.fetchedAt = today;
    return item;
  });
  return items.filter((p) => p && p.end >= today);
}

/* ---------- Source E: bokji (한국사회복지협의회 복지넷 사업공모) ---------- */
const BOKJI_LIST = "https://www.bokji.net/not/biz/01.bokji";
const BOKJI_VIEW = "https://www.bokji.net/not/biz/01_01.bokji?BOARDIDX=";

function parseBokjiList(html) {
  return html
    .split("<tr")
    .slice(1)
    .map((r) => {
      if (/class="notice"/.test(r)) return null;
      const a = r.match(/goView\('(\d+)'\)">([\s\S]*?)<\/a>/);
      const w = r.match(/<td class="writer">([\s\S]*?)<\/td>/);
      const d = r.match(/<td class="date">(\d{4})-(\d{2})-(\d{2})<\/td>/);
      if (!a || !d) return null;
      return { id: a[1], title: clean(a[2]), org: w ? clean(w[1]) : "", posted: d[1] + "-" + d[2] + "-" + d[3] };
    })
    .filter(Boolean);
}

function titleEndHint(title, posted) {
  const m = title.match(/~\s*(\d{1,2})\s*[\/.]\s*(\d{1,2})/);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let y = Number(posted.slice(0, 4));
  let iso = toISO(y, mo, d);
  if (iso < posted) iso = toISO(y + 1, mo, d);
  return iso;
}

const BOKJI_CLOSED = /모집\s?완료|신청\s?완료|접수\s?완료|마감\s?되|조기\s?마감|마감\s?안내|종료\s?안내/;

function parseBokjiDetail(it, html) {
  const all = htmlToLines(html.split('class="boardFooter"')[0]);
  const at = all.findIndex((l) => l.startsWith(it.title.slice(0, 15)));
  const lines = at >= 0 ? all.slice(at + 2) : all;
  if (BOKJI_CLOSED.test(it.title)) return null;
  let range = findPeriod(lines, it.posted);
  const hint = titleEndHint(it.title, it.posted);
  if (hint && (!range || hint > range.end)) {
    range = { start: range && range.start <= hint ? range.start : it.posted, end: hint };
  }
  if (!range) return null;

  const tm = it.title.match(/^\[([^\]]+)\]\s*(.*)$/);
  const title = (tm && tm[2] ? tm[2] : it.title).trim();
  if (!title) return null;
  const tags = classify(title + " " + lines.join(" ").slice(0, 700));
  return {
    source: "bokji",
    title,
    org: it.org,
    url: BOKJI_VIEW + it.id,
    start: range.start,
    end: range.end,
    target: tags.target,
    category: tags.category,
  };
}

async function scrapeBokji(today, ctx) {
  const pageErrors = [];
  const lists = await pool(
    [1, 2, 3, 4, 5],
    5,
    async (n) => parseBokjiList(await (await get(BOKJI_LIST + "?PG=" + n, null, Math.min(4000, ctx.timeLeft()))).text()),
    pageErrors
  );
  if (!lists.some((l) => l && l.length)) {
    throw new Error("bokji: no items parsed. " + (pageErrors[0] || "unknown"));
  }
  const seen = new Set();
  const cands = [];
  for (const list of lists) {
    for (const it of list || []) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      cands.push(it);
    }
  }
  const items = await pool(cands, 10, async (it) => {
    const url = BOKJI_VIEW + it.id;
    const known = ctx.known[url];
    if (known && known.fetchedAt && daysBetween(today, known.fetchedAt) < 2) return known;
    if (ctx.timeLeft() < 1500) return known || null;
    const html = await (await get(url, null, Math.min(6000, ctx.timeLeft()))).text();
    const item = parseBokjiDetail(it, html);
    if (item) item.fetchedAt = today;
    return item;
  });
  return items.filter((p) => p && p.end >= today);
}

/* ---------- all sources ---------- */
export async function scrapeAll(today, opts) {
  const day = today || todayKST();
  const budgetMs = (opts && opts.budgetMs) || 8000;
  const t0 = Date.now();
  const ctx = {
    known: (opts && opts.known) || {},
    timeLeft: () => budgetMs - (Date.now() - t0),
  };
  const jobs = { kpang: scrapeKpang, holt: scrapeHolt, kaswc: scrapeKaswc, saswc: scrapeSaswc, bokji: scrapeBokji };
  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(names.map((n) => jobs[n](day, ctx)));
  const items = {};
  const errors = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") items[names[i]] = r.value;
    else errors[names[i]] = String((r.reason && r.reason.message) || r.reason);
  });
  return { items, errors };
}
