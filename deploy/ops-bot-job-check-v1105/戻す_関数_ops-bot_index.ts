// bot/payment-details.mjs
var field = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
function paymentIdentity(order, check, payment = {}) {
  return { order_number: order.displayNumber ?? null, check_number: check.displayNumber ?? null, order_opened_date: order.openedDate ?? null, payment_paid_date: payment.paidDate ?? null };
}
function hawaiiTransactionTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return "\u672A\u53D6\u5F97 / Unavailable";
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n - 10 * 36e5).toISOString().slice(0, 19).replace("T", " ") + " HST" : "\u672A\u53D6\u5F97 / Unavailable";
}
function paymentVoidDetails(c) {
  if (c.kind !== "void") return "";
  const p = c.payload || c, number = (v) => field(v) ? "#" + field(v).replace(/^#/, "") : "\u672A\u53D6\u5F97 / Unavailable";
  const lines = [
    "\u5BFE\u8C61\u55B6\u696D\u65E5 / Business date: " + (field(c.business_date) || "\u672A\u53D6\u5F97 / Unavailable"),
    "\u30AA\u30FC\u30C0\u30FC / Order #: " + number(p.order_number),
    "\u4F1D\u7968 / Check #: " + number(p.check_number)
  ];
  const old = /^Payment Void\s*\/\s*(.+)$/i.exec(c.subject || "");
  if (!field(p.order_number) && !field(p.check_number) && old) lines.push("\u65E7\u53C2\u7167\u756A\u53F7 / Legacy ref: " + field(old[1]) + " (\u7A2E\u5225\u672A\u78BA\u8A8D / Type unverified)");
  if (p.order_opened_date) lines.push("\u6CE8\u6587\u65E5\u6642 / Order time: " + hawaiiTransactionTime(p.order_opened_date));
  if (p.payment_paid_date) lines.push("\u652F\u6255\u65E5\u6642 / Payment time: " + hawaiiTransactionTime(p.payment_paid_date));
  lines.push("Void\u65E5\u6642 / Voided: " + hawaiiTransactionTime(p.void_date));
  const amount = p.amount, known = amount !== null && amount !== void 0 && amount !== "" && Number.isFinite(Number(amount));
  lines.push("\u91D1\u984D / Amount: " + (known ? "$" + Number(amount).toFixed(2) : "\u91D1\u984D\u4E0D\u660E / Unavailable"));
  return lines.join("\n");
}

// bot/case-replies.mjs
function parseCaseReply(input) {
  const text = String(input || "").normalize("NFKC").trim();
  const m = /^(#\d+|B-[A-F0-9]{12})\s+(.+)$/is.exec(text);
  if (!m) return null;
  const commands = [["unchanged", /^(?:内容確認済み[・\s]*変更なし|確認済み[・\s]*変更なし|confirmed[ ,;-]*no change)\s+(.+)$/is], ["fixed", /^(?:修正済み?|修正しました|fixed|corrected)\s+(.+)$/is], ["other", /^(?:その他[・\s]*終了|other[ -]*close)\s+(.+)$/is], ["continue", /^(?:その他[・\s]*対応継続|対応中|in progress)\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/is], ["hq_approve", /^(?:承認して終了|本部承認|approve)\s+(.+)$/is], ["hq_return", /^(?:差し戻し|return)\s+(.+)$/is]];
  for (const [action, pattern] of commands) {
    const hit = pattern.exec(m[2]);
    if (hit) {
      if (action === "continue") {
        const d = /* @__PURE__ */ new Date(hit[1] + "T00:00:00Z");
        if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== hit[1]) return { code: m[1].toUpperCase(), invalid: true };
      }
      const note = (action === "continue" ? hit[2] : hit[1]).trim();
      if (!note || note.length > 4e3 || /[?？]/.test(note)) return { code: m[1].toUpperCase(), invalid: true };
      return { code: m[1].toUpperCase(), action, note, ...action === "continue" ? { due_date: hit[1] } : {} };
    }
  }
  return { code: m[1].toUpperCase(), invalid: true };
}
var replyHelp = (code) => `${code} \u5B8C\u4E86 / done
\u8907\u6570\u306F\u6848\u4EF6\u756A\u53F7\u3092\u30AB\u30F3\u30DE\u3067\u533A\u5207\u308B / Separate case numbers with commas
${code} \u4FEE\u6B63\u6E08\u307F \u4FEE\u6B63\u5185\u5BB9
${code} \u78BA\u8A8D\u6E08\u307F\u30FB\u5909\u66F4\u306A\u3057 \u7406\u7531
${code} \u305D\u306E\u4ED6\u30FB\u7D42\u4E86 \u7406\u7531
${code} \u5BFE\u5FDC\u4E2D YYYY-MM-DD \u5BFE\u5FDC\u5185\u5BB9
English: fixed / confirmed no change / other close / in progress YYYY-MM-DD + reason`;
function replyChoices(code) {
  return { items: [["\u4FEE\u6B63\u6E08\u307F / Fixed", `${code} \u4FEE\u6B63\u6E08\u307F `], ["\u5909\u66F4\u306A\u3057 / No change", `${code} \u78BA\u8A8D\u6E08\u307F\u30FB\u5909\u66F4\u306A\u3057 `], ["\u305D\u306E\u4ED6 / Other", `${code} \u305D\u306E\u4ED6\u30FB\u7D42\u4E86 `], ["\u5BFE\u5FDC\u4E2D / In progress", `${code} \u5BFE\u5FDC\u4E2D `]].map(([label, fillInText]) => ({ type: "action", action: { type: "postback", label, data: "case_reply=" + encodeURIComponent(code), inputOption: "openKeyboard", fillInText } })) };
}
function responseReceipt(c, { includeTransaction = true } = {}) {
  const states = { hq_review: "\u672C\u90E8\u78BA\u8A8D\u5F85\u3061 / Awaiting HQ review", verify: "\u4FEE\u6B63\u53CD\u6620\u306E\u78BA\u8A8D\u5F85\u3061 / Awaiting verification", correction: "\u5BFE\u5FDC\u7D99\u7D9A / Action required", done: "\u5B8C\u4E86 / Closed" };
  const decision = c.payload?.closure || c.payload?.returned || c.payload?.response || {};
  const at = decision.at ? new Date(decision.at).toLocaleString("ja-JP", { timeZone: "Pacific/Honolulu" }) : "";
  const details = includeTransaction ? paymentVoidDetails(c) : "";
  return `${details ? "\u6848\u4EF6 / Case: " : ""}${c.code}\uFF5C${c.payload?.store_name || c.store_id}\uFF5C${details ? "Payment Void" : c.subject}
${states[c.status] || c.status}
${details ? details + "\n" : ""}${decision.note || ""}
\u78BA\u8A8D\u8005 / By: ${decision.actor || "Toast"}${at ? "\uFF5C" + at + " HST" : ""}`;
}
function parseCompletionReply(input) {
  const text = String(input || "").normalize("NFKC").trim();
  const m = /^(?:案件\s*)?((?:#\d+|B-[A-F0-9]{12})(?:(?:\s*[,、・]\s*|\s+)(?:#\d+|B-[A-F0-9]{12}))*)\s*(.+)$/is.exec(text);
  if (!m) return null;
  const codes = [...new Set(m[1].toUpperCase().match(/#\d+|B-[A-F0-9]{12}/g))];
  const hit = /^(完了(?:しました|です|報告)?|対応完了|終了(?:しました)?|確認済み(?:[・\s]*変更なし)?|内容確認済み(?:[・\s]*変更なし)?|修正済み?|修正しました|その他[・\s]*終了|done|completed|closed|fixed|corrected|confirmed(?:[ ,;-]*no change)?|other[ -]*close)(?:[。.!！]|\s+(.+))?$/is.exec(m[2].trim());
  if (!hit) return null;
  if (codes.length > 20 || text.length > 4e3) return { codes, invalid: true, reason: "limit" };
  if (/[?？]|ですか|でしょうか|ましたか|ません|ない|なかった|未完了|未確認|未修正|まだ|\b(?:not|yet|never|cannot)\b|\b(?:isn|aren|wasn|weren|hasn|haven|hadn|didn|don|doesn|can|couldn|wouldn|shouldn)['’]t\b/i.test(m[2])) return { codes, invalid: true, reason: "unclear" };
  return { codes, note: m[2].trim() };
}
function completionReceipt(result) {
  const header = (result.results || []).some((c) => c.status === "done" && !c.error) ? "Your completion report has been received.\n\u5B8C\u4E86\u5831\u544A\u3092\u627F\u308A\u307E\u3057\u305F\u3002" : "Unable to accept the completion report. Please check the results below.\n\u5B8C\u4E86\u5831\u544A\u3092\u53D7\u3051\u4ED8\u3051\u3089\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u4EE5\u4E0B\u3092\u3054\u78BA\u8A8D\u304F\u3060\u3055\u3044\u3002";
  return header + "\n\n" + (result.results || []).map((c) => `${c.code}\uFF5C${c.error === "not_found" ? "\u5BFE\u8C61\u6848\u4EF6\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093 / Not found" : c.error === "invalid_kind" ? "\u5B8C\u4E86\u5831\u544A\u306E\u5BFE\u8C61\u5916 / Unsupported" : c.already_closed ? "\u5B8C\u4E86\u6E08\u307F / Already closed" : c.status === "done" ? "\u5B8C\u4E86 / Closed" : "\u53D7\u4ED8\u3067\u304D\u307E\u305B\u3093 / Not accepted"}${c.subject ? "\uFF5C" + String(c.subject).slice(0, 100) : ""}`).join("\n");
}

// bot/clock-detector.mjs
function createClockDetector({ getTipLabor, getCeCfg }) {
  if (typeof getTipLabor !== "function" || typeof getCeCfg !== "function")
    throw new TypeError("Effective labor and configuration providers are required");
  var CE_DEFAULT_CFG = { nightFrom: "03:00", nightTo: "05:00", longH: 12, shortMin: 15 };
  var CE_KIND_LABEL = {
    auto: "\u81EA\u52D5\u30AF\u30ED\u30C3\u30AF\u30A2\u30A6\u30C8\u7591\u3044",
    reverse: "IN/OUT\u9006\u8EE2",
    bad: "\u6642\u523B\u4E0D\u6B63",
    long: "\u9577\u6642\u9593",
    short: "\u6975\u7AEF\u306B\u77ED\u3044",
    overlap: "\u6253\u523B\u91CD\u8907"
  };
  var CE_ERROR_KINDS = ["auto", "reverse", "bad"];
  function _ceMinOfDay(iso) {
    if (!iso) return null;
    var ms = new Date(iso).getTime();
    if (isNaN(ms)) return null;
    var d = new Date(ms - 10 * 3600 * 1e3);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  function _ceHm(str) {
    var m = String(str || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? +m[1] * 60 + +m[2] : null;
  }
  function _ceClock(iso) {
    var m = _ceMinOfDay(iso);
    if (m == null) return "--:--";
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }
  function _ceHours(sh) {
    if (!sh || !sh.inDate || !sh.outDate) return null;
    var a = new Date(sh.inDate).getTime(), b = new Date(sh.outDate).getTime();
    if (isNaN(a) || isNaN(b)) return null;
    return (b - a) / 36e5;
  }
  function _ceInNight(min, cfg) {
    var a = _ceHm(cfg.nightFrom), b = _ceHm(cfg.nightTo);
    if (min == null || a == null || b == null) return false;
    return a <= b ? min >= a && min <= b : min >= a || min <= b;
  }
  function ceCheckShift(sh, cfg) {
    cfg = cfg || getCeCfg();
    var kinds = [];
    if (!sh || !sh.inDate) return { level: null, kinds, hours: 0 };
    var h = _ceHours(sh);
    if (h == null) {
      kinds.push("bad");
      return { level: "error", kinds, hours: 0 };
    }
    if (h <= 0) kinds.push("reverse");
    if (_ceInNight(_ceMinOfDay(sh.outDate), cfg)) kinds.push("auto");
    if (kinds.length) return { level: "error", kinds, hours: h };
    if (h > cfg.longH) kinds.push("long");
    else if (h * 60 < cfg.shortMin) kinds.push("short");
    return { level: kinds.length ? "warn" : null, kinds, hours: h };
  }
  function _ceOverlap(shifts) {
    var a = (shifts || []).filter(function(x) {
      return x && x.inDate && x.outDate;
    }).map(function(x) {
      return { s: new Date(x.inDate).getTime(), e: new Date(x.outDate).getTime() };
    }).filter(function(x) {
      return !isNaN(x.s) && !isNaN(x.e) && x.e > x.s;
    }).sort(function(p, q) {
      return p.s - q.s;
    });
    for (var i = 1; i < a.length; i++) {
      if (a[i].s < a[i - 1].e) return true;
    }
    return false;
  }
  function ceIsSystemAccount2(name) {
    var n = String(name || "").normalize("NFKC").toLowerCase().replace(/[\s_\-.]+/g, " ").trim();
    return n === "order" || /(?:^| )(?:order ?only|kiosk(?: ?mode)?)(?: |$)/.test(n);
  }
  function ceScanDay(storeId, date, cfg) {
    cfg = cfg || getCeCfg();
    var out = { date, rows: [], nError: 0, nWarn: 0 };
    var labor = getTipLabor(storeId, date);
    if (!labor) return out;
    Object.keys(labor).forEach(function(n) {
      if (ceIsSystemAccount2(n)) return;
      var e = labor[n] || {}, shifts = e.shifts || [];
      if (!shifts.length) return;
      var kinds = {}, level = null, det = [];
      shifts.forEach(function(sh) {
        var r = ceCheckShift(sh, cfg);
        if (!r.kinds.length) return;
        r.kinds.forEach(function(k) {
          kinds[k] = 1;
        });
        if (r.level === "error") level = "error";
        else if (r.level === "warn" && level !== "error") level = "warn";
        det.push({
          inClock: _ceClock(sh.inDate),
          outClock: _ceClock(sh.outDate),
          hours: Math.round((r.hours || 0) * 100) / 100,
          kinds: r.kinds
        });
      });
      if (_ceOverlap(shifts)) {
        kinds["overlap"] = 1;
        if (level !== "error") level = "warn";
      }
      if (!level) return;
      out.rows.push({ name: n, date, level, kinds: Object.keys(kinds), det });
      if (level === "error") out.nError++;
      else out.nWarn++;
    });
    return out;
  }
  return { ceIsSystemAccount: ceIsSystemAccount2, ceCheckShift, ceScanDay, _ceOverlap, _ceClock, CE_DEFAULT_CFG, CE_KIND_LABEL, CE_ERROR_KINDS };
}

// bot/cash-tip-report.mjs
var DAYS = ["\u65E5", "\u6708", "\u706B", "\u6C34", "\u6728", "\u91D1", "\u571F"];
var clean = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").slice(0, 100);
function cashTipEntered(record, side) {
  if (!record || typeof record !== "object") return false;
  const flag = record[side + "Entered"];
  if (!(flag === true || flag === void 0 && record.entered === true)) return false;
  const value = record[side];
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0;
}
function cashTipFindings({ from, to, stores, cash = {}, hours = {}, closures = {}, config = {} }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw Error("invalid_cash_tip_range");
  const start = Date.parse(from + "T00:00:00Z"), end = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 31 * 864e5) throw Error("invalid_cash_tip_range");
  const rows = [];
  for (const store of stores) {
    const id = store.store_id || store.id;
    if (store.active === false || (config.excluded_store_ids || []).includes(id)) continue;
    for (let at = start; at <= end; at += 864e5) {
      const date = new Date(at).toISOString().slice(0, 10), dow = DAYS[new Date(at).getUTCDay()];
      if (date < (config.first_business_dates?.[id] || from) || date > (config.last_business_dates?.[id] || to)) continue;
      const special = closures[id]?.[date]?.mode, mode = special || store.bizDays?.[dow] || store.data?.bizDays?.[dow];
      if (mode === "closed") continue;
      const window = hours[id]?.mode === "hours" ? hours[id]?.dow?.[dow] : null;
      const required = ["lunch", "dinner"].filter((side) => side === "lunch" ? mode !== "lclose" && window?.lOn !== false : mode !== "dclose" && window?.dOn !== false);
      const missing = required.filter((side) => !cashTipEntered(cash[id]?.[date], side));
      if (missing.length) rows.push({ store_id: id, store_name: store.name || id, business_date: date, missing });
    }
  }
  return rows.sort((a, b) => a.store_id.localeCompare(b.store_id) || a.business_date.localeCompare(b.business_date));
}
function formatCashTipReport(rows, { from, to, resend = false } = {}) {
  if (!rows.length) return { category: "cash_tip", messages: [], total: 0, complete: true, detail_count: 0 };
  const lines = ["\u3010\u30AD\u30E3\u30C3\u30B7\u30E5\u30C1\u30C3\u30D7\u672A\u5165\u529B" + (resend ? "\uFF5C\u518D\u9001" : "") + "\u3011", "Cash tips: missing entries", "\u5BFE\u8C61\uFF1A" + from + "\u301C" + to, "\u672A\u5165\u529B\uFF1A" + rows.length + "\u5E97\u8217\u65E5", "\u73FE\u91D1\u30C1\u30C3\u30D7\u304C\u306A\u304B\u3063\u305F\u5834\u5408\u3082\u300C0\u300D\u3092\u5165\u529B\u30FB\u4FDD\u5B58\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "Enter and save 0 when no cash tips were received.", "Funergy\uFF0B\u306E\u30AD\u30E3\u30C3\u30B7\u30E5\u30C1\u30C3\u30D7\u5165\u529B\u3092\u4FDD\u5B58\u30FB\u540C\u671F\u3059\u308B\u3068\u3001\u6B21\u56DE\u306E\u901A\u77E5\u304B\u3089\u5916\u308C\u307E\u3059\u3002"];
  let text = lines.join("\n"), messages = [], lastStore = null;
  for (const row of rows) {
    const label = row.missing.map((s) => s === "lunch" ? "\u30E9\u30F3\u30C1 / Lunch" : "\u30C7\u30A3\u30CA\u30FC / Dinner").join("\u30FB");
    const heading = row.store_id !== lastStore ? "\n\n" + clean(row.store_name) + " (" + clean(row.store_id) + ")" : "";
    const line = "\n" + row.business_date + "\uFF1A" + label;
    if (text.length + heading.length + line.length > 4200) {
      messages.push({ type: "text", text });
      text = clean(row.store_name) + " (" + clean(row.store_id) + ")";
    } else text += heading;
    text += line;
    lastStore = row.store_id;
  }
  messages.push({ type: "text", text: text + "\n\n\u3010\u30EC\u30DD\u30FC\u30C8\u7D42\u4E86\u3011\u672A\u5165\u529B " + rows.length + "\u5E97\u8217\u65E5\u3092\u5168\u4EF6\u63B2\u8F09" });
  messages = messages.map((m, i) => ({ type: "text", text: "\u3010\u30AD\u30E3\u30C3\u30B7\u30E5\u30C1\u30C3\u30D7\uFF5C\u7D4C\u7406 " + (i + 1) + "/" + messages.length + "\u3011\n" + m.text }));
  return { category: "cash_tip", messages, total: rows.length, detail_count: rows.length, complete: true };
}
function reportRoute(config, category) {
  if (!config?.routes) return null;
  const route = config.routes[category === "cash_tip" ? "finance" : category];
  if (!route || !/^C[a-f0-9]{32}$/i.test(route.group_id || "") || !route.label) throw Error("report_route_not_configured");
  return route;
}
function caseCategory(kind) {
  return kind === "labor" ? "labor" : ["void", "unpaid"].includes(kind) ? "finance" : null;
}

// supabase/functions/ops-bot/handler.mjs
var ROLES = ["ceo", "gm", "office", "office_crew"];
var APPROVERS = ["ceo", "gm", "office"];
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
var enc = new TextEncoder();
function dailyDisposition(c, day) {
  if (c.status === "done") return "done";
  if (c.status === "hq_review") return "hq_review";
  if (c.status === "verify") return "verify";
  if (c.due_date && c.due_date > day) return "scheduled";
  if (c.status === "correction" && c.payload?.returned && c.due_date && c.due_date <= day) return "action";
  const checked = c.last_checked_at && new Date(new Date(c.last_checked_at).getTime() - 10 * 36e5).toISOString().slice(0, 10);
  if (checked !== day || c.payload?.fetched_at && Date.parse(c.last_checked_at) < Date.parse(c.payload.fetched_at)) return "unverified";
  return ["still_flagged_or_manual_review", "payment_not_confirmed", "payment_coverage_incomplete"].includes(c.last_check?.message) ? "action" : "review";
}
function validConfig(c) {
  if (!c || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(c.nightFrom) || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(c.nightTo) || !(Number(c.longH) > 0 && Number(c.longH) <= 24) || !(Number(c.shortMin) > 0 && Number(c.shortMin) <= 240)) throw Error("invalid_config");
  return { nightFrom: c.nightFrom, nightTo: c.nightTo, longH: Number(c.longH), shortMin: Number(c.shortMin) };
}
function safePurchaseURL(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    throw Error("invalid_url");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !u.hostname.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname) || /\.(local|internal)$/i.test(u.hostname)) throw Error("invalid_url");
  return u.href;
}
function businessDate(input, now = Date.now()) {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) throw Error("invalid_date");
  const d = /* @__PURE__ */ new Date(input + "T00:00:00Z");
  if (!isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== input || input >= new Date(now - 10 * 36e5).toISOString().slice(0, 10)) throw Error("closed_day_required");
  return input;
}
async function validSignature(raw, signature, secret) {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)), raw);
}
var { ceIsSystemAccount } = createClockDetector({ getTipLabor: () => null, getCeCfg: () => null });
function isBotSystemAccount(name, storeID) {
  const normalized = String(name || "").normalize("NFKC").toLowerCase().replace(/[\s_\-.*]+/g, " ").trim();
  return ceIsSystemAccount(name) || /(?:^| )toast generic login(?: |$)/.test(normalized) || storeID === "F06" && normalized === "server default";
}
function laborFindings(entries, employees, cfg, store, date, override = false) {
  validConfig(cfg);
  const names = new Map(employees.map((e) => [e.guid, ((e.firstName || "") + " " + (e.lastName || "")).trim() || e.name || e.guid]));
  const people = {};
  for (const te of entries) {
    const id = te.employeeReference?.guid;
    if (te.deleted || !te.guid || !id || isBotSystemAccount(names.get(id), store.store_id)) continue;
    (people[id] ??= []).push({ guid: te.guid, inDate: te.inDate ?? null, outDate: te.outDate ?? null, employee_guid: id, autoClockedOut: te.autoClockedOut === true });
  }
  const effective = Object.fromEntries(Object.entries(people).map(([id, shifts]) => [id, { shifts }]));
  const detector = createClockDetector({ getCeCfg: () => cfg, getTipLabor: () => effective });
  return detector.ceScanDay(store.store_id, date).rows.map((r) => ({
    source_key: "labor:" + store.store_id + ":" + date + ":" + r.name,
    kind: "labor",
    store_id: store.store_id,
    business_date: date,
    subject: (names.get(r.name) || r.name) + " / " + r.kinds.join(", "),
    payload: {
      employee_guid: r.name,
      employee_name: names.get(r.name) || r.name,
      store_name: store.name,
      kinds: r.kinds,
      shifts: people[r.name],
      cfg,
      override,
      source: "toast_direct",
      fetched_at: (/* @__PURE__ */ new Date()).toISOString(),
      fingerprint: JSON.stringify({ shifts: people[r.name], kinds: r.kinds, cfg, override }),
      open_shift: people[r.name].some((x) => !x.outDate),
      draft: ""
    }
  }));
}
function paymentIsVoided(p) {
  return p.paymentStatus === "VOIDED" || p.type !== "CREDIT" && !!p.voidInfo?.voidDate;
}
function voidFindings(orders, store, date, reasons = [], employees = []) {
  const reasonNames = new Map(reasons.map((x) => [x.guid, x.name]));
  const staffNames = new Map(employees.map((x) => [x.guid, ((x.firstName || "") + " " + (x.lastName || "")).trim() || x.name || x.guid]));
  const rows = [];
  for (const order of orders) for (const check of order.checks || []) for (const pay of check.payments || []) {
    if (!pay.guid || !paymentIsVoided(pay)) continue;
    const vi = pay.voidInfo || {}, reason = vi.voidReason?.guid;
    rows.push({ source_key: "void:" + store.store_id + ":" + pay.guid, kind: "void", store_id: store.store_id, business_date: date, subject: "Payment Void / #" + (check.displayNumber || order.displayNumber || pay.guid), payload: { store_name: store.name, order_guid: order.guid, check_guid: check.guid, entity_guid: pay.guid, ...paymentIdentity(order, check, pay), fingerprint: JSON.stringify({ amount: pay.amount ?? null, total: check.totalAmount ?? null, void: pay.voidInfo ?? null, status: pay.paymentStatus ?? null }), scope: "payment", check_total: check.totalAmount ?? null, amount: pay.amount ?? null, reason: reasonNames.get(reason) || null, user_name: staffNames.get(vi.voidUser?.guid) || null, approver_name: staffNames.get(vi.voidApprover?.guid) || null, reason_guid: reason || null, user_guid: vi.voidUser?.guid || null, approver_guid: vi.voidApprover?.guid || null, void_date: vi.voidDate || null, source: "toast_direct", fetched_at: (/* @__PURE__ */ new Date()).toISOString() } });
  }
  return rows;
}
function unpaidFindings(orders, store, date) {
  const rows = [];
  for (const order of orders) {
    if (order.deleted || order.voided) continue;
    for (const c of order.checks || []) {
      if (!c.guid || c.deleted || c.voided || c.paymentStatus !== "OPEN" || !(Number(c.totalAmount ?? c.amount) > 0)) continue;
      rows.push({ source_key: "unpaid:" + store.store_id + ":" + c.guid, kind: "unpaid", store_id: store.store_id, business_date: date, subject: "Unpaid / #" + (c.displayNumber || order.displayNumber || c.guid), payload: { store_name: store.name, order_guid: order.guid, check_guid: c.guid, amount: c.totalAmount ?? c.amount, payment_status: c.paymentStatus, source: "toast_direct", fingerprint: JSON.stringify({ status: c.paymentStatus, total: c.totalAmount ?? c.amount }), fetched_at: (/* @__PURE__ */ new Date()).toISOString() } });
    }
  }
  return rows;
}
function financeResolution(c, order) {
  const no = (reason) => ({ clean: false, message: reason });
  if (!order || order.guid !== c.payload.order_guid || order.deleted || order.voided) return no("order_missing_or_cancelled_review");
  const checks = (order.checks || []).filter((x) => x.guid === c.payload.check_guid);
  if (checks.length !== 1) return no("check_missing_manual_review");
  const check = checks[0];
  if (check.deleted || check.voided) return no("check_cancelled_manual_review");
  if (c.kind === "void" && (check.payments || []).filter((p) => p.guid === c.payload.entity_guid).length !== 1) return no("payment_missing_manual_review");
  const total = Number(check.totalAmount);
  if (check.paymentStatus !== "CLOSED" || !Number.isFinite(total) || total <= 0) return no("payment_not_confirmed");
  if (c.kind === "void" && (!Number.isFinite(Number(c.payload.check_total)) || Number(c.payload.check_total) <= 0 || Math.round(total * 100) !== Math.round(Number(c.payload.check_total) * 100))) return no("bill_changed_manual_review");
  if (c.kind === "unpaid" && Math.round(total * 100) !== Math.round(Number(c.payload.amount) * 100)) return no("bill_changed_manual_review");
  let received = 0;
  const ids = [];
  for (const p of check.payments || []) {
    if (paymentIsVoided(p) || !p.guid || !p.paidDate) continue;
    if (p.type === "CREDIT" ? p.paymentStatus !== "CAPTURED" : !["CASH", "GIFTCARD", "HOUSE_ACCOUNT", "REWARDCARD", "LEVELUP", "TOAST_SV", "OTHER"].includes(p.type)) continue;
    if (p.type !== "CREDIT" && ["CANCELLED", "ERROR", "ERROR_NETWORK", "DENIED", "PROCESSING_VOID"].includes(p.paymentStatus)) continue;
    if (p.refundStatus === "FULL" || p.refundStatus && !["NONE", "PARTIAL"].includes(p.refundStatus)) continue;
    if ((p.refundStatus === "PARTIAL" || p.refund) && (!p.refund || typeof p.refund.refundAmount !== "number" || typeof p.refund.tipRefundAmount !== "number")) continue;
    const values = [p.amount, p.tipAmount ?? 0, p.refund?.refundAmount ?? 0, p.refund?.tipRefundAmount ?? 0].map(Number);
    if (values.some((x) => !Number.isFinite(x) || x < 0)) continue;
    const net = values[0] + values[1] - values[2] - values[3];
    if (net <= 0) continue;
    received += Math.round(net * 100);
    ids.push(p.guid);
  }
  if (received < Math.round(total * 100)) return no("payment_coverage_incomplete");
  return { clean: true, verification_type: c.kind === "unpaid" ? "unpaid_paid" : "payment_void_recovered", check_guid: check.guid, payment_guids: ids, total, received: received / 100 };
}
function lineMentionMessage(text, user) {
  if (!user) return { type: "text", text };
  if (!/^U[a-f0-9]{32}$/i.test(user)) throw Error("invalid_line_user");
  const escaped = text.replaceAll("{", "{{").replaceAll("}", "}}");
  if (escaped.length + 12 > 5e3) throw Error("invalid_message");
  return { type: "textV2", text: "{assignee}\n" + escaped, substitution: { assignee: { type: "mention", mentionee: { type: "user", userId: user } } } };
}
var MORNING_KIND_JA = { auto: "\u81EA\u52D5\u30AF\u30ED\u30C3\u30AF\u30A2\u30A6\u30C8\u7591\u3044", reverse: "IN/OUT\u9006\u8EE2", bad: "\u6642\u523B\u4E0D\u6B63", long: "\u9577\u6642\u9593\u52E4\u52D9", short: "\u6975\u7AEF\u306B\u77ED\u3044\u52E4\u52D9", overlap: "\u6253\u523B\u91CD\u8907" };
var MORNING_PROGRESS = { not_sent: "\u{1F534} \u672A\u901A\u77E5", notify_failed: "\u{1F534} \u901A\u77E5\u5931\u6557\u30FB\u8981\u78BA\u8A8D", waiting: "\u{1F7E0} \u5BFE\u5FDC\u5F85\u3061", reminder_failed: "\u{1F7E0} \u5BFE\u5FDC\u5F85\u3061\uFF08\u518D\u901A\u77E5\u5931\u6557\uFF09", in_progress: "\u{1F7E1} \u4FEE\u6B63\u5BFE\u5FDC\u4E2D", recheck: "\u{1F535} \u5B8C\u4E86\u5831\u544A\u6E08\u307F\u30FBToast\u518D\u78BA\u8A8D\u5F85\u3061", send_check: "\u26AA \u9001\u4FE1\u7D50\u679C\u78BA\u8A8D", review: "\u26AA \u672C\u90E8\u78BA\u8A8D\u5F85\u3061" };
function morningField(value, max = 120) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function morningIssue(c) {
  const raw = Array.isArray(c.kinds) ? c.kinds : [], labels = raw.map((k) => k === "bad" && c.open_shift === true ? "\u9000\u52E4\u6253\u523B\u306A\u3057" : MORNING_KIND_JA[k] || morningField(k, 50));
  return labels.length ? labels.join("\u30FB") : "\u8981\u78BA\u8A8D";
}
function morningProgress(c) {
  if (c.status === "hq_review") return "\u672C\u90E8\u78BA\u8A8D\u5F85\u3061";
  if (c.status === "verify") return "\u4FEE\u6B63\u53CD\u6620\u5F85\u3061";
  const key = morningField(c.progress, 30) || "review";
  return MORNING_PROGRESS[key] || MORNING_PROGRESS.review;
}
function morningShiftLines(c) {
  const shifts = Array.isArray(c.shifts) ? c.shifts.filter((x) => x && typeof x === "object") : [];
  if (!shifts.length) return "\u6253\u523B\uFF1A\u8A73\u7D30\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3002Funergy\uFF0B\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044";
  const ms = (v) => v ? Date.parse(v) : NaN;
  const clock = (v, missing) => {
    if (!v) return missing;
    const n = ms(v);
    return Number.isFinite(n) ? new Date(n - 10 * 36e5).toISOString().slice(5, 16).replace("-", "/").replace("T", " ") : "\u6642\u523B\u4E0D\u6B63";
  };
  let cfg;
  try {
    cfg = validConfig(c.shift_cfg);
  } catch {
  }
  const detector = createClockDetector({ getTipLabor: () => null, getCeCfg: () => cfg });
  const rows = shifts.filter((x) => x && typeof x === "object").map((sh, i) => {
    const a = ms(sh.inDate), b = ms(sh.outDate), valid = Number.isFinite(a) && Number.isFinite(b) && b > a;
    const overlap = valid && shifts.some((other, j) => j !== i && other && ms(other.outDate) > ms(other.inDate) && a < ms(other.outDate) && ms(other.inDate) < b);
    let kinds = cfg ? detector.ceCheckShift(sh, cfg).kinds : [];
    if (!sh.inDate || !sh.outDate) kinds = [.../* @__PURE__ */ new Set([...kinds, "bad"])];
    if (overlap) kinds = [...kinds, "overlap"];
    const reasons = kinds.map((k) => k === "bad" ? !sh.inDate ? "\u51FA\u52E4\u672A\u6253\u523B" : !sh.outDate ? "\u9000\u52E4\u672A\u6253\u523B" : "\u6642\u523B\u4E0D\u6B63" : k === "long" ? "\u9577\u6642\u9593\uFF1A" + cfg.longH + "\u6642\u9593\u8D85" : k === "short" ? "\u77ED\u6642\u9593\uFF1A" + cfg.shortMin + "\u5206\u672A\u6E80" : k === "auto" ? "\u81EA\u52D5\u9000\u52E4\u7591\u3044\uFF1A\u9000\u52E4\u304C" + cfg.nightFrom + "\u301C" + cfg.nightTo : k === "overlap" ? "\u4ED6\u306E\u6253\u523B\u3068\u91CD\u8907" : MORNING_KIND_JA[k] || k);
    const minutes = valid ? Math.round((b - a) / 6e4) : null, duration = minutes === null ? "\u6642\u9593\u7B97\u51FA\u4E0D\u53EF" : Math.floor(minutes / 60) + "\u6642\u9593" + String(minutes % 60).padStart(2, "0") + "\u5206";
    return { flag: kinds.length > 0, text: "\u52E4\u52D9" + (i + 1) + "\uFF1A" + clock(sh.inDate, "\u51FA\u52E4\u672A\u6253\u523B") + " \u2192 " + clock(sh.outDate, "\u9000\u52E4\u672A\u6253\u523B") + "\uFF08" + duration + "\uFF09\n" + (reasons.length ? "\u78BA\u8A8D\u70B9\uFF1A" + reasons.join("\uFF0F") : cfg ? "\u3053\u306E\u6253\u523B\u306E\u5358\u72EC\u30A8\u30E9\u30FC\u306A\u3057" : "\u5224\u5B9A\u8A2D\u5B9A\u672A\u53D6\u5F97\u30FB\u52E4\u52D9\u3092\u78BA\u8A8D") };
  }).sort((a, b) => Number(b.flag) - Number(a.flag));
  return "\u691C\u77E5\u6642\u306E\u6253\u523B\uFF08HST\u30FB\u4F11\u61A9\u63A7\u9664\u524D\uFF09\n" + rows.map((x) => x.text).join("\n");
}
function morningCaseBlock(c, index, category = null) {
  const date = morningField(c.business_date, 10).slice(5).replace("-", "/"), code = morningField(c.code, 20), progress = morningProgress(c), assignee = category === "labor" ? "Moto\u30FBYuki" : category === "finance" ? "\u7D4C\u7406" : morningField(c.assignee, 100) || "\u5E97\u8217\u62C5\u5F53\u8005\u672A\u8A2D\u5B9A";
  if (c.kind === "labor") {
    const name = morningField(c.employee_name || c.subject || "\u6C0F\u540D\u4E0D\u660E", 100);
    return index + ". " + name + "\uFF08" + date + "\uFF09\n\u5185\u5BB9\uFF1A" + morningIssue(c) + "\n" + morningShiftLines(c) + "\n\u9032\u6357\uFF1A" + progress + "\n\u62C5\u5F53\uFF1A" + assignee + "\n\u6848\u4EF6\uFF1A" + code;
  }
  const ref = morningField(c.subject, 100).replace(/^Payment Void \/\s*|^Unpaid \/\s*/i, ""), hasAmount = c.amount !== null && c.amount !== void 0 && c.amount !== "", amount = Number(c.amount), money = hasAmount && Number.isFinite(amount) ? "$" + amount.toFixed(2) : "\u91D1\u984D\u4E0D\u660E";
  if (c.kind === "void") {
    const who = morningField(c.user_name, 100), approver = morningField(c.approver_name, 100), reason = morningField(c.reason, Infinity);
    return index + ". Payment Void\n" + paymentVoidDetails(c) + (who ? "\n\u64CD\u4F5C\uFF1A" + who : "") + (approver ? "\uFF0F\u627F\u8A8D\uFF1A" + approver : "") + (reason ? "\n\u7406\u7531\uFF1A" + reason : "") + "\n\u9032\u6357\uFF1A" + progress + "\n\u62C5\u5F53\uFF1A" + assignee + "\n\u6848\u4EF6\uFF1A" + code;
  }
  return index + ". Unpaid " + ref + "\uFF08" + date + "\uFF09\n\u91D1\u984D\uFF1A" + money + "\n\u9032\u6357\uFF1A" + progress + "\n\u62C5\u5F53\uFF1A" + assignee + "\n\u6848\u4EF6\uFF1A" + code;
}
function morningTextParts(text, max = 4300) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let end = rest.lastIndexOf("\n", max);
    if (end < 1) end = max;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
    if (rest.startsWith("\n")) rest = rest.slice(1);
  }
  if (rest) parts.push(rest);
  return parts;
}
function morningStoreMessages(details, total, stores = [], category = null) {
  if (!Array.isArray(details) || !details.length) return [];
  if (details.length !== Number(total)) throw Error("morning_summary_incomplete_details");
  const groups = /* @__PURE__ */ new Map();
  const storeTotals = new Map((Array.isArray(stores) ? stores : []).map((s) => [morningField(s.store_id, 80), Number(s.labor || 0) + Number(s.void || 0) + Number(s.unpaid || 0)]));
  for (const row of details) {
    const key = morningField(row.store_id, 80);
    if (!groups.has(key)) groups.set(key, { key, name: morningField(row.store_name || row.store_id, 80), rows: [] });
    groups.get(key).rows.push(row);
  }
  const sections = [];
  for (const group of groups.values()) {
    const header = "\u3010" + group.name + "\uFF5C\u672A\u89E3\u6C7A " + (storeTotals.get(group.key) ?? group.rows.length) + "\u4EF6\u3011";
    let text = header;
    for (let i = 0; i < group.rows.length; i++) {
      const c = group.rows[i], block = morningCaseBlock(c, i + 1, category) + (c.due_date ? "\n\u671F\u9650\uFF1A" + c.due_date : "") + (c.response ? "\n\u56DE\u7B54\uFF1A" + morningField(c.response.actor, 80) + " / " + morningField(c.response.note, Infinity) : "") + (c.returned ? "\n\u5DEE\u3057\u623B\u3057\uFF1A" + morningField(c.returned.note, Infinity) : "");
      const parts = morningTextParts(block, 4e3);
      for (let j = 0; j < parts.length; j++) {
        const piece = (parts.length > 1 ? "\u6848\u4EF6\uFF1A" + morningField(c.code, 20) + "\uFF5C\u9032\u6357\uFF1A" + morningProgress(c) + "\uFF5C\u8A73\u7D30 " + (j + 1) + "/" + parts.length + "\n" : "") + parts[j];
        if (text.length + piece.length + 2 > 4500) {
          sections.push(text);
          text = header + "\uFF08\u7D9A\u304D\uFF09";
        }
        text += "\n\n" + piece;
      }
    }
    sections.push(text);
  }
  return sections;
}
function formatMorningSummary(s, { resend = false, category = null } = {}) {
  const n = (k) => Number(s?.counts?.[k] || 0), complete = Number(s?.active_stores) > 0 && Number(s?.ok) === Number(s?.expected) && Number(s?.failed) === 0 && (category === "labor" || s?.finance_enabled === true && Number(s?.finance_ok) === Number(s?.expected));
  const labor = n("labor"), voids = n("void"), unpaid = n("unpaid"), total = labor + voids + unpaid, period = Number(s.expected) === 0 && Number(s.active_stores) > 0 ? "\u5F53\u6708\u306F\u5BFE\u8C61\u65E5\u306A\u3057" : s.from + "\u301C" + s.to, p = s.progress_counts || {};
  const title = category === "labor" ? "\u52E4\u6020\u7BA1\u7406\u30EC\u30DD\u30FC\u30C8" : category === "finance" ? "\u4F1A\u8A08\u7BA1\u7406\u30EC\u30DD\u30FC\u30C8" : "\u6BCE\u671D \u672C\u90E8\u78BA\u8A8D\u30EC\u30DD\u30FC\u30C8";
  const lines = ["\u3010" + title + (resend ? "\uFF5C\u518D\u9001" : "") + "\u3011", ...category ? ["\u7BA1\u7406\u62C5\u5F53\uFF1A" + (category === "labor" ? "Moto\u30FBYuki" : "\u7D4C\u7406")] : [], "\u5BFE\u8C61\uFF1A" + period, category === "labor" ? "\u52E4\u6020\u53D6\u5F97\uFF1A" + Number(s.ok || 0) + "/" + Number(s.expected || 0) : "\u53D6\u5F97\uFF1A" + Number(s.ok || 0) + "/" + Number(s.expected || 0) + "\u3000\u6C7A\u6E08\u78BA\u8A8D\uFF1A" + Number(s.finance_ok || 0) + "/" + Number(s.expected || 0), "\u672A\u89E3\u6C7A\uFF1A" + total + "\u4EF6" + (category === "labor" ? "\uFF08\u52E4\u6020\uFF09" : category === "finance" ? "\uFF08Payment Void " + voids + "\uFF0FUnpaid " + unpaid + "\uFF09" : "\uFF08\u52E4\u6020 " + labor + "\uFF0FPayment Void " + voids + "\uFF0FUnpaid " + unpaid + "\uFF09")];
  if (total > 0) lines.push("\u9032\u6357\uFF1A\u672A\u901A\u77E5 " + Number(p.not_sent || 0) + "\uFF0F\u901A\u77E5\u5931\u6557 " + Number(p.notify_failed || 0) + "\uFF0F\u5BFE\u5FDC\u5F85\u3061 " + Number(p.waiting || 0) + "\uFF0F\u518D\u901A\u77E5\u5931\u6557 " + Number(p.reminder_failed || 0) + "\uFF0F\u4FEE\u6B63\u4E2D " + Number(p.in_progress || 0) + "\uFF0F\u518D\u78BA\u8A8D\u5F85\u3061 " + Number(p.recheck || 0) + "\uFF0F\u672C\u90E8\u78BA\u8A8D " + Number(p.review || 0) + "\uFF0F\u9001\u4FE1\u78BA\u8A8D " + Number(p.send_check || 0));
  if (Number(s?.active_stores) === 0) lines.push("\u26A0\uFE0F \u6709\u52B9\u5E97\u8217\u304C\u3042\u308A\u307E\u305B\u3093");
  if (category !== "labor" && (s?.finance_enabled !== true || Number(s?.finance_ok) !== Number(s?.expected))) lines.push("\u26A0\uFE0F \u6C7A\u6E08\u30C7\u30FC\u30BF\u306E\u53D6\u5F97\u304C\u672A\u5B8C\u4E86\u3067\u3059");
  if (!complete) lines.push("\u26A0\uFE0F \u53D6\u5F97\u672A\u5B8C\u4E86\uFF1A" + Number(s.ok || 0) + "/" + Number(s.expected || 0) + "\u3001\u5931\u6557 " + Number(s.failed || 0));
  else if (total === 0) lines.push("\u2705 \u73FE\u5728\u3001\u672A\u89E3\u6C7A\u306E\u7570\u5E38\u306F\u3042\u308A\u307E\u305B\u3093");
  else lines.push("\u2705 \u30C7\u30FC\u30BF\u53D6\u5F97\u5B8C\u4E86\u3000\u5E97\u8217\u5225\u30EC\u30DD\u30FC\u30C8\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044");
  lines.push("\u672C\u90E8\u78BA\u8A8D\u5F85\u3061\uFF1A" + Number(s.status_counts?.hq_review || 0) + "\u4EF6");
  const text = lines.join("\n");
  if (text.length > 4900) throw Error("invalid_message");
  const detailCount = Number(s.detail_total ?? (Array.isArray(s.details) ? s.details.length : 0));
  if (s.detail_total !== void 0 && (detailCount !== (s.details || []).length || detailCount !== total)) throw Error("morning_summary_incomplete_details");
  if (total === 0 && complete) return { text: "", messages: [], complete, total, detail_count: detailCount };
  const messages = [{ type: "text", text }, ...morningStoreMessages(s.details, detailCount, s.stores, category).map((detail) => ({ type: "text", text: detail }))];
  messages[messages.length - 1].text += "\n\n\u3010\u30EC\u30DD\u30FC\u30C8\u7D42\u4E86\u3011\u672A\u89E3\u6C7A " + detailCount + "\u4EF6\u3092\u5168\u4EF6\u63B2\u8F09";
  for (let i = 0; i < messages.length; i++) messages[i].text = "\u3010" + (category === "labor" ? "\u52E4\u6020\u7BA1\u7406\uFF5CMoto\u30FBYuki" : category === "finance" ? "\u4F1A\u8A08\u7BA1\u7406\uFF5C\u7D4C\u7406" : "\u672C\u90E8\u30EC\u30DD\u30FC\u30C8") + " " + (i + 1) + "/" + messages.length + "\u3011\n" + messages[i].text;
  return { text, messages, complete, total, detail_count: detailCount };
}
function formatResponsibleMorningReports(s, options = {}) {
  const details = s.details || [], known = (c) => ["labor", "void", "unpaid"].includes(c.kind);
  if (details.some((c) => !known(c))) throw Error("morning_summary_missing_case_kind");
  if (s.detail_total !== void 0 && Number(s.detail_total) !== details.length) throw Error("morning_summary_incomplete_details");
  if (s.counts && ["labor", "void", "unpaid"].some((k) => Number(s.counts[k] || 0) !== details.filter((c) => c.kind === k).length)) throw Error("morning_summary_incomplete_details");
  const reports = ["labor", "finance"].map((category) => {
    const belongs = (c) => category === "labor" ? c.kind === "labor" : c.kind === "void" || c.kind === "unpaid", rows = details.filter(belongs), progress = {}, statuses = {};
    for (const c of rows) {
      const key = c.status === "hq_review" ? "review" : c.status === "verify" ? "recheck" : c.progress || "review";
      progress[key] = (progress[key] || 0) + 1;
      statuses[c.status] = (statuses[c.status] || 0) + 1;
    }
    const stores = (s.stores || []).map((store) => ({ ...store, labor: category === "labor" ? store.labor : 0, void: category === "finance" ? store.void : 0, unpaid: category === "finance" ? store.unpaid : 0 }));
    return { category, ...formatMorningSummary({ ...s, details: rows, detail_total: rows.length, counts: { labor: rows.filter((c) => c.kind === "labor").length, void: rows.filter((c) => c.kind === "void").length, unpaid: rows.filter((c) => c.kind === "unpaid").length }, stores, progress_counts: progress, status_counts: statuses }, { ...options, category }) };
  });
  return { reports, messages: reports.flatMap((r) => r.messages), text: reports.map((r) => r.text).filter(Boolean).join("\n\n"), complete: reports.every((r) => r.complete), total: details.length, detail_count: details.length };
}
function createHandler({ env, fetch: fetcher = globalThis.fetch }) {
  const sb = env("SUPABASE_URL"), service = env("SUPABASE_SERVICE_ROLE_KEY"), anon = env("SUPABASE_ANON_KEY");
  const headers = { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" };
  const timed = (url, init = {}) => fetcher(url, { ...init, signal: AbortSignal.timeout(2e4) });
  async function db(path, method = "GET", body, prefer) {
    const r = await timed(sb + "/rest/v1/" + path, { method, headers: { ...headers, ...prefer ? { Prefer: prefer } : {} }, ...body === void 0 ? {} : { body: JSON.stringify(body) } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const known = ["conflict", "forbidden", "not_found", "send_unresolved", "retry_mismatch", "failed_send_requires_new_review", "retry_expired_check_line", "group_not_enabled", "closed_case", "purchase_details_required", "order_number_required", "invalid_state", "note_required", "assignee_required", "daily_date_changed", "daily_already_prepared", "recheck_required", "hq_review_required", "response_required", "due_date_required"];
      throw Error(known.find((x) => j.message?.includes(x)) || (r.status === 409 ? "conflict" : "database_error"));
    }
    const text = await r.text();
    return text.trim() ? JSON.parse(text) : null;
  }
  const rpc = (name, args) => db("rpc/" + name, "POST", args);
  const setting = async (key) => (await db("bot_settings?key=eq." + key + "&select=value"))[0]?.value || null;
  async function authorize(req) {
    const authorization = req.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ") || authorization === "Bearer " + anon) throw Error("unauthorized");
    const r = await timed(sb + "/auth/v1/user", { headers: { apikey: anon, Authorization: authorization } });
    if (!r.ok) throw Error("unauthorized");
    const u = await r.json();
    if (!u.id) throw Error("unauthorized");
    const roles = await db("manager_auth?user_id=eq." + encodeURIComponent(u.id) + "&select=role");
    if (roles.length === 1 && ROLES.includes(roles[0].role)) return { id: u.id, role: roles[0].role };
    const members = await db("bot_users?user_id=eq." + encodeURIComponent(u.id) + "&enabled=eq.true&select=user_id");
    if (members.length !== 1) throw Error("forbidden");
    return { id: u.id, role: "office_crew", bot_only: true };
  }
  async function getStore(id) {
    const a = await db("store_config?store_id=eq." + encodeURIComponent(id) + "&active=eq.true&select=store_id,restaurant_guid,name");
    if (a.length !== 1) throw Error("invalid_store");
    return a[0];
  }
  async function toastClient(store) {
    if (!env("TOAST_CLIENT_ID") || !env("TOAST_CLIENT_SECRET")) throw Error("toast_not_configured");
    const r = await timed("https://ws-api.toasttab.com/authentication/v1/authentication/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: env("TOAST_CLIENT_ID"), clientSecret: env("TOAST_CLIENT_SECRET"), userAccessType: "TOAST_MACHINE_CLIENT" }) });
    if (!r.ok) throw Error("toast_auth_failed");
    const token = (await r.json())?.token?.accessToken;
    if (!token) throw Error("toast_auth_failed");
    return async (path, object = false) => {
      let url = new URL("https://ws-api.toasttab.com" + path), all = [], seen = /* @__PURE__ */ new Set();
      for (let page = 0; page < 40; page++) {
        const r2 = await timed(url.href, { headers: { Authorization: "Bearer " + token, "Toast-Restaurant-External-ID": store.restaurant_guid } });
        if (!r2.ok) throw Error(r2.status === 429 ? "toast_rate_limited" : "toast_read_failed");
        const j = await r2.json();
        if (object) {
          if (!j || Array.isArray(j) || typeof j !== "object") throw Error("toast_invalid_response");
          return j;
        }
        if (!Array.isArray(j)) throw Error("toast_invalid_response");
        all.push(...j);
        const next = r2.headers.get("Toast-Next-Page-Token");
        if (!next) return all;
        if (seen.has(next)) throw Error("toast_pagination_loop");
        seen.add(next);
        url.searchParams.set("pageToken", next);
      }
      throw Error("toast_pagination_limit");
    };
  }
  function paymentLookupCache() {
    return { stores: /* @__PURE__ */ new Map(), orders: /* @__PURE__ */ new Map(), until: Date.now() + 3e4 };
  }
  async function paymentCaseDetails(c, cache = paymentLookupCache()) {
    const p = c.payload || {};
    if (c.kind !== "void" || p.order_number && p.check_number && p.order_opened_date || Date.now() > cache.until || !UUID.test(p.order_guid || "") || !UUID.test(p.check_guid || "") || !UUID.test(p.entity_guid || "")) return c;
    try {
      if (!cache.stores.has(c.store_id)) cache.stores.set(c.store_id, getStore(c.store_id).then(toastClient));
      const get = await cache.stores.get(c.store_id), key = c.store_id + ":" + p.order_guid;
      if (!cache.orders.has(key)) cache.orders.set(key, get("/orders/v2/orders/" + p.order_guid, true));
      const order = await cache.orders.get(key);
      if (order.guid !== p.order_guid) return c;
      const checks = (order.checks || []).filter((x) => x.guid === p.check_guid);
      if (checks.length !== 1) return c;
      const payments = (checks[0].payments || []).filter((x) => x.guid === p.entity_guid);
      if (payments.length !== 1 || !paymentIsVoided(payments[0])) return c;
      const identity = paymentIdentity(order, checks[0], payments[0]), missing = {};
      for (const [key2, value] of Object.entries(identity)) if (!p[key2] && value !== null && value !== "") missing[key2] = value;
      return { ...c, payload: { ...p, ...missing } };
    } catch {
      return c;
    }
  }
  async function scan(storeID, date, actor, withVoids = false) {
    const store = await getStore(storeID), cfg = validConfig(await setting("clock"));
    if (!await rpc("bot_take_run", { p_store: storeID })) throw Error("scan_busy");
    try {
      const get = await toastClient(store), bd = date.replaceAll("-", "");
      const entries = await get("/labor/v1/timeEntries?businessDate=" + bd), employees = await get("/labor/v1/employees");
      const overrides = await db("app_state?key=eq." + encodeURIComponent("att_override_" + storeID + "_" + date) + "&select=value");
      const override = !!overrides[0]?.value?.data;
      const findings = laborFindings(entries, employees, cfg, store, date, override);
      if (withVoids) {
        const orders = [];
        let complete = false;
        for (let page = 1; page <= 40; page++) {
          const batch = await get("/orders/v2/ordersBulk?businessDate=" + bd + "&pageSize=100&page=" + page);
          orders.push(...batch);
          if (batch.length < 100) {
            complete = true;
            break;
          }
        }
        if (!complete) throw Error("toast_pagination_limit");
        findings.push(...unpaidFindings(orders, store, date));
        const ids = await get("/orders/v2/payments?voidBusinessDate=" + bd);
        if (ids.length > 100 || ids.some((id) => !UUID.test(id))) throw Error("payment_batch_requires_review");
        let reasons = [];
        try {
          reasons = await get("/config/v2/voidReasons");
        } catch {
        }
        const payments = [];
        for (const id of [...new Set(ids)]) {
          const pay = await get("/orders/v2/payments/" + id, true);
          if (pay.guid !== id || !UUID.test(pay.orderGuid || "") || !UUID.test(pay.checkGuid || "")) throw Error("toast_invalid_response");
          const order = orders.find((o) => o.guid === pay.orderGuid) || await get("/orders/v2/orders/" + pay.orderGuid, true);
          if (order.guid !== pay.orderGuid) throw Error("toast_invalid_response");
          const check = (order.checks || []).find((c) => c.guid === pay.checkGuid);
          payments.push({ guid: pay.orderGuid, displayNumber: order.displayNumber, openedDate: order.openedDate, checks: [{ guid: pay.checkGuid, displayNumber: check?.displayNumber, totalAmount: check?.totalAmount, payments: [pay] }] });
        }
        findings.push(...voidFindings(payments, store, date, reasons, employees));
      }
      for (const f of findings) await rpc("bot_case_write", { p_op: "finding", p_actor: actor, p_data: f });
      await db("bot_runs?store_id=eq." + encodeURIComponent(storeID), "PATCH", { running_until: null, last_success: (/* @__PURE__ */ new Date()).toISOString(), last_error: null });
      return { created_or_matched: findings.length, override, entries: entries.length };
    } catch (e) {
      await db("bot_runs?store_id=eq." + encodeURIComponent(storeID), "PATCH", { running_until: null, last_error: String(e.message).slice(0, 80) }).catch(() => {
      });
      throw e;
    }
  }
  async function rangeRun(storeID) {
    const job = await rpc("bot_claim_range", { p_store: storeID });
    if (!job) return { skipped: true, range_complete_or_waiting: true };
    try {
      const cfg = await setting("worker");
      const result = await scan(storeID, job.business_date, null, cfg?.finance_enabled === true);
      const start = Date.now(), pending = await db("bot_cases?kind=in.(labor,void,unpaid)&status=not.in.(done,hq_review)&or=" + encodeURIComponent("(kind.neq.void,payload->>scope.eq.payment)") + "&store_id=eq." + encodeURIComponent(storeID) + "&business_date=eq." + job.business_date + "&order=last_checked_at.asc.nullsfirst,created_at.asc&limit=20");
      for (const c of pending) {
        if (Date.now() - start > 45e3) break;
        try {
          await recheck(c, null);
        } catch {
        }
      }
      await rpc("bot_finish_range_v2", { p_store: storeID, p_date: job.business_date, p_lease: job.lease_id, p_error: null, p_finance: cfg?.finance_enabled === true });
      return { ...result, business_date: job.business_date, range: true };
    } catch (e) {
      await rpc("bot_finish_range_v2", { p_store: storeID, p_date: job.business_date, p_lease: job.lease_id, p_error: /^[a-z_]+$/.test(e.message) ? e.message : "scan_failed", p_finance: false }).catch(() => {
      });
      throw e;
    }
  }
  async function dailyOverview(after) {
    if (after !== void 0 && after !== null && !UUID.test(after)) throw Error("invalid_cursor");
    const overview = await rpc("bot_range_overview", {});
    const rows = await db("bot_cases?kind=in.(labor,void,unpaid)&status=neq.done&or=" + encodeURIComponent("(kind.neq.void,payload->>scope.eq.payment)") + "&business_date=lt." + overview.day + "&order=id.asc&limit=101" + (after ? "&id=gt." + after : ""));
    const cases = rows.slice(0, 100);
    const sends = cases.length ? await db("bot_outbox?case_id=in.(" + cases.map((c) => c.id).join(",") + ")&reminder_date=eq." + overview.day + "&state=in.(sent,pending,unknown)&select=case_id,state") : [];
    for (const c of cases) {
      c.daily_send = sends.find((o) => o.case_id === c.id)?.state || null;
      c.daily_check = dailyDisposition(c, overview.day);
    }
    return { overview, cases, next: rows.length > 100 ? cases.at(-1).id : null };
  }
  async function flushCaseNotices() {
    if (!env("LINE_CHANNEL_ACCESS_TOKEN")) return { skipped: true };
    const notices = await db("bot_events?kind=eq.lifecycle_notice&data->>state=in.(pending,unknown)&order=id.asc&limit=5"), lookup = paymentLookupCache();
    let sent = 0;
    for (const e of notices) {
      let n = e.data;
      if (n.case?.status === "done") {
        await db("bot_events?id=eq." + e.id, "PATCH", { data: { ...n, state: "morning_summary", delivery: "daily_hq_report" } });
        continue;
      }
      if (Date.parse(e.created_at) < Date.now() - 23 * 36e5) {
        await db("bot_events?id=eq." + e.id, "PATCH", { data: { ...n, state: "expired" } });
        continue;
      }
      const groups = await db("bot_groups?group_id=eq." + encodeURIComponent(n.group_id) + "&enabled=eq.true");
      const current = await db("bot_cases?id=eq." + e.case_id + "&select=status,status_version,kind,business_date,subject,payload,store_id");
      if (!groups.length || !groups[0].all_stores && groups[0].store_id !== n.case.store_id || !current.length || current[0].status !== n.case.status || current[0].status_version !== n.case.status_version) {
        await db("bot_events?id=eq." + e.id, "PATCH", { data: { ...n, state: "cancelled" } });
        continue;
      }
      if (!await routeAllowed(current[0].kind, n.group_id)) {
        await db("bot_events?id=eq." + e.id, "PATCH", { data: { ...n, state: "cancelled", reason: "report_route_changed" } });
        continue;
      }
      if (!n.line_message) {
        const legacy = n.state === "unknown";
        const detailed = legacy ? n.case : await paymentCaseDetails({ ...n.case, kind: current[0].kind, business_date: current[0].business_date, payload: { ...current[0].payload, ...n.case.payload } }, lookup);
        const line_message = { type: "text", text: responseReceipt(detailed, { includeTransaction: !legacy }).slice(0, 4600) + (n.case.status === "hq_review" ? "\n" + n.case.code + " \u627F\u8A8D\u3057\u3066\u7D42\u4E86 \u7406\u7531 / approve reason\n" + n.case.code + " \u5DEE\u3057\u623B\u3057 \u7406\u7531 / return reason" : "") };
        const saved = await db("bot_events?id=eq." + e.id + "&data->line_message=is.null&data->>state=in.(pending,unknown)", "PATCH", { data: { ...n, line_message, state: "unknown" } }, "return=representation");
        n = saved?.[0]?.data || (await db("bot_events?id=eq." + e.id + "&select=data"))[0]?.data;
        if (!n?.line_message || !["pending", "unknown"].includes(n.state)) continue;
      }
      const [latest, activeGroups] = await Promise.all([
        db("bot_cases?id=eq." + e.case_id + "&select=status,status_version"),
        db("bot_groups?group_id=eq." + encodeURIComponent(n.group_id) + "&enabled=eq.true")
      ]);
      if (!activeGroups.length || !activeGroups[0].all_stores && activeGroups[0].store_id !== n.case.store_id || !latest.length || latest[0].status !== n.case.status || latest[0].status_version !== n.case.status_version) {
        await db("bot_events?id=eq." + e.id + "&data->>state=in.(pending,unknown)", "PATCH", { data: { ...n, state: "cancelled" } });
        continue;
      }
      if (!await routeAllowed(current[0].kind, n.group_id)) continue;
      let state = "unknown";
      try {
        const response = await timed("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN"), "Content-Type": "application/json", "X-Line-Retry-Key": n.request_id }, body: JSON.stringify({ to: n.group_id, messages: [n.line_message] }) });
        state = response.ok || response.status === 409 && !!response.headers.get("x-line-accepted-request-id") ? "sent" : response.status >= 400 && response.status < 500 && response.status !== 429 ? "failed" : "unknown";
      } catch {
      }
      await db("bot_events?id=eq." + e.id + "&data->>state=in.(pending,unknown)", "PATCH", { data: { ...n, state } });
      if (state === "sent") sent++;
    }
    return { sent };
  }
  async function groupDirectory() {
    if (!env("LINE_CHANNEL_ACCESS_TOKEN")) throw Error("line_token_missing");
    const groups = await db("bot_groups?select=group_id,label,enabled,all_stores");
    const results = [];
    for (const group of groups) {
      if (!/^C[a-f0-9]{32}$/i.test(group.group_id)) continue;
      try {
        const r = await timed("https://api.line.me/v2/bot/group/" + group.group_id + "/summary", { headers: { Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN") } });
        const data = r.ok ? await r.json() : {};
        results.push({ ...group, live_name: typeof data.groupName === "string" ? data.groupName : null, line_status: r.status });
      } catch {
        results.push({ ...group, live_name: null, line_status: null });
      }
    }
    return { groups: results };
  }
  async function routeAllowed(kind, group) {
    const category = caseCategory(kind);
    if (!category) return true;
    const cfg = await setting("morning_summary");
    let route;
    try {
      route = reportRoute(cfg, category);
    } catch {
      return false;
    }
    return !route || cfg.enabled === true && route.group_id === group;
  }
  async function cashTipReport(snapshot, cfg, variant) {
    if (cfg.cash_tip?.enabled !== true) return null;
    const [stores, masters, states] = await Promise.all([
      db("store_config?active=eq.true&select=store_id,name,active"),
      db("stores?select=id,data"),
      db("app_state?or=" + encodeURIComponent("(key.like.cash_tips_*,key.eq.tip_hours_config,key.eq.store_closures)") + "&select=key,value")
    ]);
    const values = Object.fromEntries(states.map((s) => [s.key, s.value])), cash = Object.fromEntries(stores.map((s) => [s.store_id, values["cash_tips_" + s.store_id] || {}]));
    const rows = cashTipFindings({ from: snapshot.from, to: snapshot.to, stores: stores.map((s) => ({ ...s, data: masters.find((m) => m.id === s.store_id)?.data })), cash, hours: values.tip_hours_config || {}, closures: values.store_closures || {}, config: cfg.cash_tip });
    return formatCashTipReport(rows, { from: snapshot.from, to: snapshot.to, resend: variant !== "daily" });
  }
  async function morningSummary(variant = "daily", preview = false, onlyCategory = null) {
    if (!["daily", "resend-details-v1", "resend-report-v1", "mention-preview-v1"].includes(variant)) throw Error("invalid_summary_variant");
    if (onlyCategory !== null && !["labor", "finance", "cash_tip"].includes(onlyCategory)) throw Error("invalid_report_category");
    const cfg = await setting("morning_summary");
    if (!cfg?.enabled) return { skipped: true, reason: "morning_summary_disabled" };
    if (onlyCategory && !cfg.routes) throw Error("report_route_not_configured");
    if (!/^C[a-f0-9]{32}$/i.test(cfg.group_id || "") || !cfg.label) throw Error("morning_summary_not_configured");
    if (!cfg.routes) {
      const groups = await db("bot_groups?group_id=eq." + encodeURIComponent(cfg.group_id) + "&enabled=eq.true&select=group_id,label,all_stores");
      if (groups.length !== 1 || groups[0].all_stores !== true || groups[0].label !== cfg.label) throw Error("group_not_enabled");
    }
    if (!env("LINE_CHANNEL_ACCESS_TOKEN")) throw Error("line_token_missing");
    const snapshot = await rpc("bot_morning_snapshot", {});
    const labor = (snapshot.details || []).filter((c) => (!onlyCategory || onlyCategory === "labor") && c.kind === "labor" && !Object.hasOwn(c, "shifts") && /^#[0-9]+$/.test(c.code));
    for (let i = 0; i < labor.length; i += 50) {
      const batch = labor.slice(i, i + 50);
      try {
        const rows = await db("bot_cases?code=in." + encodeURIComponent("(" + batch.map((c) => c.code).join(",") + ")") + "&select=code,payload");
        for (const c of batch) {
          const p = rows.find((r) => r.code === c.code)?.payload;
          if (p && JSON.stringify(p.kinds) === JSON.stringify(c.kinds) && p.employee_name === c.employee_name) {
            c.shifts = p.shifts;
            c.shift_cfg = p.cfg;
          }
        }
      } catch {
      }
    }
    const voids = (snapshot.details || []).filter((c) => (!onlyCategory || onlyCategory === "finance") && c.kind === "void" && /^#[0-9]+$/.test(c.code)), lookup = paymentLookupCache();
    for (let i = 0; i < voids.length; i += 50) {
      const batch = voids.slice(i, i + 50);
      try {
        const rows = await db("bot_cases?code=in." + encodeURIComponent("(" + batch.map((c) => c.code).join(",") + ")") + "&select=code,kind,store_id,subject,business_date,payload,status,closed_at,updated_at");
        for (const c of batch) {
          const row = rows.find((r) => r.code === c.code);
          if (!row || row.kind !== "void" || row.store_id !== c.store_id || row.subject !== c.subject || c.business_date && row.business_date !== c.business_date || c.amount !== void 0 && Number(c.amount) !== Number(row.payload?.amount)) continue;
          const snapshotAt = Date.parse(snapshot.snapshot_at), updatedAt = Date.parse(row.updated_at);
          if (!Number.isFinite(snapshotAt) || !Number.isFinite(updatedAt) || updatedAt > snapshotAt) continue;
          const detailed = await paymentCaseDetails(row, lookup);
          c.payload = detailed.payload;
          c.business_date = row.business_date;
        }
      } catch {
      }
    }
    const formatted = variant === "mention-preview-v1" ? { messages: [{ type: "text", text: "\u3010\u8868\u793A\u30C6\u30B9\u30C8\uFF5C\u793E\u54E1\u30E1\u30F3\u30B7\u30E7\u30F3\u901A\u77E5\u3011\n\uFF3B\u767B\u9332\u6E08\u307F\u793E\u54E1\u3078\u306E\u30E1\u30F3\u30B7\u30E7\u30F3\u304C\u3053\u3053\u306B\u8868\u793A\u3055\u308C\u307E\u3059\uFF3D\n\n\u5E97\u8217\uFF1A\u30B5\u30F3\u30D7\u30EB\u5E97\u8217\n\u5BFE\u8C61\uFF1A\u30B9\u30BF\u30C3\u30D5\u540D\n\u5185\u5BB9\uFF1A\u52E4\u6020\u30A8\u30E9\u30FC\n\u9032\u6357\uFF1A\u{1F7E0} \u5BFE\u5FDC\u5F85\u3061\n\u6848\u4EF6\uFF1A#123\n\n\u5BFE\u5FDC\u5F8C\u306F\u300C#123 \u4FEE\u6B63\u6E08\u307F \u4FEE\u6B63\u5185\u5BB9\u300D\u3068\u8FD4\u4FE1\u3057\u3066\u304F\u3060\u3055\u3044\u3002\n\u203B\u8868\u793A\u78BA\u8A8D\u7528\u3067\u3059\u3002\u5BFE\u5FDC\u306F\u4E0D\u8981\u3067\u3059\u3002" }], complete: true, total: 0, detail_count: 0 } : formatResponsibleMorningReports(snapshot, { resend: variant !== "daily" });
    if (cfg.routes) {
      if (variant === "mention-preview-v1") throw Error("invalid_summary_variant");
      const reports = formatted.reports.filter((r) => !onlyCategory || r.category === onlyCategory);
      if (!onlyCategory || onlyCategory === "cash_tip") {
        try {
          const cash = await cashTipReport(snapshot, cfg, variant);
          if (cash) reports.push(cash);
        } catch {
          reports.push({ category: "cash_tip", error: "cash_tip_read_failed" });
        }
      }
      if (preview) return { day: snapshot.day, from: snapshot.from, to: snapshot.to, reports: reports.map((r) => {
        try {
          return { ...r, route: reportRoute(cfg, r.category) };
        } catch {
          return { ...r, route: null, route_error: "report_route_not_configured" };
        }
      }) };
      const results = [];
      for (const report of reports) {
        try {
          if (report.error) throw Error(report.error);
          const route = reportRoute(cfg, report.category);
          results.push({ category: report.category, ...await deliverMorningReport(snapshot, report, route, variant, report.category) });
        } catch (e) {
          results.push({ category: report.category, state: "failed", error: /^[a-z_]+$/.test(e.message) ? e.message : "report_failed" });
        }
      }
      return { day: snapshot.day, reports: results };
    }
    if (preview) return { day: snapshot.day, reports: formatted.reports || [], route: cfg };
    return deliverMorningReport(snapshot, formatted, cfg, variant);
  }
  async function deliverMorningReport(snapshot, formatted, cfg, variant, category = null) {
    if (!formatted.messages.length) return { state: "skipped", reason: "no_findings", day: snapshot.day };
    const reserved = await rpc(category ? "bot_reserve_morning_report" : "bot_reserve_morning_summary_v3", { p_day: snapshot.day, p_group: cfg.group_id, p_request: crypto.randomUUID(), p_messages: formatted.messages, p_variant: variant, p_snapshot_at: snapshot.snapshot_at || null, ...category ? { p_category: category } : {} });
    if (reserved.data?.state === "accepted") return { state: "accepted", already_sent: true, day: snapshot.day };
    if (reserved.data?.state === "failed") return { state: "failed", review_required: true, day: snapshot.day };
    const batches = reserved.data?.batches;
    if (!Array.isArray(batches) || !batches.length) throw Error("morning_summary_invalid_reservation");
    const legacyCompletion = (message) => {
      const text = String(message?.text || "").replace(/^【(?:勤怠管理｜Moto・Yuki|会計管理｜経理|本部レポート) [0-9]+\/[0-9]+】\n/, "");
      return text.startsWith("\u3010\u78BA\u8A8D\u5B8C\u4E86\u306E\u5B9A\u6642\u5831\u544A\uFF5C\u6BCE\u671D9:00 HST\u3011") || /^【(?:勤怠管理レポート|会計管理レポート|毎朝 本部確認レポート)(?:｜再送)?】\n/.test(text) && text.split("\n").includes("\u2705 \u73FE\u5728\u3001\u672A\u89E3\u6C7A\u306E\u7570\u5E38\u306F\u3042\u308A\u307E\u305B\u3093");
    };
    if (batches.some((b) => b.state !== "accepted" && (b.messages || []).some(legacyCompletion))) return { state: "skipped", reason: "legacy_completion_report", day: snapshot.day };
    let sent = 0;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i], messages = batch.messages, request = batch.request_id;
      if (batch.state === "accepted") continue;
      if (!UUID.test(request || "") || !Array.isArray(messages) || messages.length < 1 || messages.length > 5 || messages.some((message) => message?.type !== "text" || typeof message.text !== "string" || message.text.length < 1 || message.text.length > 4900)) throw Error("morning_summary_invalid_reservation");
      const latest = await setting("morning_summary"), route = category ? reportRoute(latest, category) : latest;
      const groups = await db("bot_groups?group_id=eq." + encodeURIComponent(cfg.group_id) + "&enabled=eq.true&select=group_id,label,all_stores");
      if (latest?.enabled !== true || !route || !category && latest.routes || route.group_id !== cfg.group_id || route.label !== cfg.label || category === "cash_tip" && latest.cash_tip?.enabled !== true || groups.length !== 1 || groups[0].all_stores !== true || groups[0].label !== cfg.label) return { state: "skipped", reason: "report_route_changed", day: snapshot.day };
      let state = "unknown", status = null, lineRequest = null;
      try {
        const r = await timed("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN"), "Content-Type": "application/json", "X-Line-Retry-Key": request }, body: JSON.stringify({ to: cfg.group_id, messages }) });
        status = r.status;
        lineRequest = r.headers.get("x-line-request-id");
        state = r.ok || r.status === 409 && !!r.headers.get("x-line-accepted-request-id") ? "accepted" : r.status >= 400 && r.status < 500 && r.status !== 429 ? "failed" : "unknown";
      } catch {
        state = "unknown";
      }
      await rpc("bot_finish_morning_summary_batch", { p_event: reserved.id, p_batch: i, p_state: state, p_status: status, p_line_request: lineRequest });
      if (state !== "accepted") return { state, day: snapshot.day, batch: i + 1, batch_count: batches.length, line_status: status, review_required: state === "failed" };
      sent += messages.length;
    }
    return { state: "accepted", day: snapshot.day, complete: formatted.complete, total: formatted.total, detail_count: formatted.detail_count, message_count: batches.reduce((n, b) => n + b.messages.length, 0), sent_message_count: sent, batch_count: batches.length };
  }
  async function recheck(c, actor) {
    try {
      return await checkCase(c, actor);
    } catch (e) {
      await rpc("bot_record_check", { p_id: c.id, p_version: c.version, p_actor: actor, p_result: { clean: false, message: /^[a-z_]+$/.test(e.message) ? e.message : "verification_failed", checked_at: (/* @__PURE__ */ new Date()).toISOString() } }).catch(() => {
      });
      throw e;
    }
  }
  async function checkCase(c, actor) {
    if (c.status === "done" || c.status === "hq_review") return { clean: c.status === "done", case: c, message: c.status === "hq_review" ? "hq_review_required" : "closed_case" };
    if (c.status === "correction" && c.payload?.returned) {
      const result2 = { clean: false, message: "awaiting_store_response", checked_at: (/* @__PURE__ */ new Date()).toISOString() };
      await rpc("bot_record_check", { p_id: c.id, p_version: c.version, p_actor: actor, p_result: result2 });
      return result2;
    }
    if (["void", "unpaid"].includes(c.kind)) {
      if (c.kind === "void" && c.payload.scope !== "payment") throw Error("item_void_out_of_scope");
      if (!UUID.test(c.payload.order_guid || "") || !UUID.test(c.payload.check_guid || "")) throw Error("order_ids_required");
      const store2 = await getStore(c.store_id), get2 = await toastClient(store2), order = await get2("/orders/v2/orders/" + c.payload.order_guid, true);
      const result2 = { ...financeResolution(c, order), checked_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (!result2.clean) {
        await rpc("bot_record_check", { p_id: c.id, p_version: c.version, p_actor: actor, p_result: result2 });
        return result2;
      }
      const updated = await rpc("bot_case_write", { p_op: "verified", p_actor: actor, p_id: c.id, p_version: c.version, p_data: result2 });
      return { ...result2, case: updated };
    }
    if (c.kind !== "labor") throw Error("unsupported_monitor_kind");
    if (isBotSystemAccount(c.payload?.employee_name, c.store_id)) {
      const evidence = { clean: true, verification_type: "nonhuman_account_excluded", message: "excluded_nonhuman_account", employee_name: c.payload.employee_name, checked_at: (/* @__PURE__ */ new Date()).toISOString() };
      const updated = await rpc("bot_case_write", { p_op: "verified", p_actor: actor, p_id: c.id, p_version: c.version, p_data: evidence });
      return { ...evidence, case: updated };
    }
    const ids = (c.payload.shifts || []).map((x) => x.guid);
    if (!ids.length || ids.length > 100 || ids.some((x) => !UUID.test(x))) throw Error("time_entry_ids_required");
    const store = await getStore(c.store_id), get = await toastClient(store), cfg = validConfig(await setting("clock"));
    const entries = [];
    for (const id of ids) {
      const j = await get("/labor/v1/timeEntries?timeEntryIds=" + encodeURIComponent(id));
      const hit = j.filter((x) => x.guid === id);
      if (hit.length !== 1) throw Error("time_entry_missing_manual_review");
      entries.push(hit[0]);
    }
    const override = await db("app_state?key=eq." + encodeURIComponent("att_override_" + c.store_id + "_" + c.business_date) + "&select=value");
    const detector = createClockDetector({ getCeCfg: () => cfg, getTipLabor: () => ({}) });
    let clean2 = !override[0]?.value?.data && entries.every((x) => !x.deleted && x.employeeReference?.guid === c.payload.employee_guid && x.outDate && !detector.ceCheckShift(x, cfg).level);
    const day = await get("/labor/v1/timeEntries?businessDate=" + c.business_date.replaceAll("-", ""));
    const shifts = day.filter((x) => !x.deleted && x.employeeReference?.guid === c.payload.employee_guid);
    if (detector._ceOverlap(shifts) || shifts.some((x) => detector.ceCheckShift(x, cfg).level)) clean2 = false;
    if (entries.some((x) => String(x.businessDate) !== c.business_date.replaceAll("-", ""))) clean2 = false;
    if (!clean2) {
      const result2 = { clean: false, message: "still_flagged_or_manual_review", checked_at: (/* @__PURE__ */ new Date()).toISOString() };
      await rpc("bot_record_check", { p_id: c.id, p_version: c.version, p_actor: actor, p_result: result2 });
      return result2;
    }
    const result = await rpc("bot_case_write", { p_op: "verified", p_actor: actor, p_id: c.id, p_version: c.version, p_data: { clean: true, checked_at: (/* @__PURE__ */ new Date()).toISOString(), time_entry_ids: ids, cfg } });
    return { clean: true, case: result };
  }
  async function lineMember(group, user) {
    if (!/^C[a-f0-9]{32}$/i.test(group || "") || !/^U[a-f0-9]{32}$/i.test(user || "")) throw Error("invalid_line_user");
    const r = await timed("https://api.line.me/v2/bot/group/" + group + "/member/" + user, { headers: { Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN") } });
    if (!r.ok) throw Error("line_member_unavailable");
    const p = await r.json();
    if (p.userId !== user) throw Error("line_member_unavailable");
    return p;
  }
  async function send(c, actor, body) {
    if (c.kind === "void" && c.payload?.scope !== "payment") throw Error("item_void_out_of_scope");
    if (!APPROVERS.includes(actor.role)) throw Error("forbidden");
    if (!env("LINE_CHANNEL_ACCESS_TOKEN")) throw Error("line_token_missing");
    if (!UUID.test(body.request_id || "")) throw Error("invalid_request_id");
    const message = String(body.text || "").trim();
    if (!message || message.length > 4900) throw Error("invalid_message");
    const previous = await db("bot_outbox?id=eq." + body.request_id + "&select=body,line_message");
    if (!previous.length && message.length > 4500) throw Error("invalid_message");
    const store = await getStore(c.store_id);
    const header = "[" + c.code + "]\n\u5E97\u8217 / Store: " + store.name + " (" + c.store_id + ")\n\u62C5\u5F53 / Assigned to: " + (c.assignee || "\u5E97\u8217\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC / Store manager") + "\n";
    const full = previous.length ? previous[0].body : header + message;
    if (!await routeAllowed(c.kind, body.group_id)) throw Error("group_not_enabled");
    const group = await db("bot_groups?group_id=eq." + encodeURIComponent(body.group_id) + "&enabled=eq.true");
    if (group.length !== 1 || !group[0].all_stores && group[0].store_id !== c.store_id) throw Error("group_not_enabled");
    let lineMessage = previous.length ? previous[0].line_message || { type: "text", text: full } : lineMentionMessage(full, null);
    if (!previous.length && body.mention_user) {
      const link = await setting("line_link:" + body.group_id + ":" + c.store_id);
      if (!link || link.user_id !== body.mention_user || link.assignee !== c.assignee) throw Error("mention_link_changed");
      await lineMember(body.group_id, link.user_id);
      lineMessage = lineMentionMessage(full, link.user_id);
    }
    if (!previous.length && ["labor", "void", "unpaid"].includes(c.kind)) lineMessage = { ...lineMessage, quickReply: replyChoices(c.code) };
    const o = await rpc(body.daily_date ? "bot_reserve_daily_send" : "bot_reserve_send_v2", { p_actor: actor.id, p_id: c.id, p_version: body.version, p_request: body.request_id, p_group: body.group_id, p_body: full, p_message: lineMessage, ...body.daily_date ? { p_day: body.daily_date } : {} });
    if (o.state === "sent") return { state: "sent", request_id: o.id };
    if (!await routeAllowed(c.kind, o.group_id)) throw Error("group_not_enabled");
    let state = "unknown";
    try {
      const r = await timed("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN"), "Content-Type": "application/json", "X-Line-Retry-Key": o.id }, body: JSON.stringify({ to: o.group_id, messages: [o.line_message || { type: "text", text: o.body }] }) });
      state = r.ok || r.status === 409 && !!r.headers.get("x-line-accepted-request-id") ? "sent" : r.status >= 400 && r.status < 500 && r.status !== 429 ? "failed" : "unknown";
    } catch {
      state = "unknown";
    }
    await rpc("bot_finish_send", { p_id: o.id, p_state: state });
    return { state, request_id: o.id };
  }
  return async function handler(req) {
    const origin = req.headers.get("origin");
    const allowed = ["https://funergy-plus.com", "https://www.funergy-plus.com", "https://motoi107.github.io"];
    const cors = origin && allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } : {};
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    try {
      if (origin && !allowed.includes(origin)) return json({ error: "origin_denied" }, 403);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const url = new URL(req.url);
      if (req.method === "GET" && url.searchParams.get("action") === "config") return json({ clock: await setting("clock") });
      if (req.method !== "POST") return json({ error: "POST_required" }, 405);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length > 256e3) return json({ error: "body_too_large" }, 413);
      if (url.searchParams.get("route") === "line") {
        const secret = env("LINE_CHANNEL_SECRET");
        if (!secret) return json({ error: "line_secret_missing" }, 503);
        if (!await validSignature(bytes, req.headers.get("x-line-signature"), secret)) return json({ error: "invalid_signature" }, 401);
        const data2 = JSON.parse(new TextDecoder().decode(bytes));
        if (!Array.isArray(data2.events)) throw Error("invalid_events");
        for (const e of data2.events) {
          const g = e.source?.groupId;
          if (!/^C[a-f0-9]{32}$/i.test(g || "")) continue;
          if (!e.webhookEventId || typeof e.webhookEventId !== "string") continue;
          const registration = e.message?.type === "text" && /^(?:担当者登録|register)\s+(.{1,120})$/i.exec(e.message.text.trim());
          if (registration && /^U[a-f0-9]{32}$/i.test(e.source?.userId || "")) {
            const groups = await db("bot_groups?group_id=eq." + g + "&enabled=eq.true");
            if (groups.length === 1) await db("bot_settings?on_conflict=key", "POST", { key: "line_candidate:" + g + ":" + e.source.userId, value: { group_id: g, user_id: e.source.userId, claimed_name: registration[1], registered_at: (/* @__PURE__ */ new Date()).toISOString() }, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, "resolution=merge-duplicates");
            continue;
          }
          if (e.type === "postback") continue;
          const text = e.message?.type === "text" ? e.message.text : "", completion = parseCompletionReply(text);
          if (completion) {
            const result = completion.invalid ? { invalid: true } : await rpc("bot_complete_reports", { p_event: e.webhookEventId, p_group: g, p_user: e.source?.userId || "", p_text: text, p_codes: completion.codes });
            if (e.replyToken && !result.ignored && !result.duplicate) {
              const message = result.invalid ? completion.reason === "limit" ? "\u6848\u4EF6\u306F20\u4EF6\u4EE5\u5185\u3001\u5831\u544A\u306F4000\u6587\u5B57\u4EE5\u5185\u3067\u9001\u3063\u3066\u304F\u3060\u3055\u3044\u3002 / Up to 20 cases and 4000 characters." : "\u5B8C\u4E86\u3068\u3057\u3066\u767B\u9332\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u5B8C\u4E86\u3057\u305F\u5834\u5408\u306F\u300C\u6848\u4EF6\u756A\u53F7 \u5B8C\u4E86\u300D\u3068\u9001\u3063\u3066\u304F\u3060\u3055\u3044\u3002 / Not closed. To confirm completion, send case number + done." : completionReceipt(result);
              await timed("https://api.line.me/v2/bot/message/reply", { method: "POST", headers: { Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN"), "Content-Type": "application/json" }, body: JSON.stringify({ replyToken: e.replyToken, messages: [{ type: "text", text: message.slice(0, 4900) }] }) });
            }
            continue;
          }
          const parsed = parseCaseReply(text);
          if (parsed) {
            const result = await rpc("bot_reply_ingest", { p_event: e.webhookEventId, p_group: g, p_user: e.source?.userId || "", p_text: text, p_code: parsed.code, p_action: parsed.invalid ? null : parsed.action, p_note: parsed.note || null, p_due: parsed.due_date || null });
            if (e.replyToken && !result.ignored && !result.duplicate) {
              const message = result.id ? responseReceipt(result) : result.error === "forbidden" ? "\u56DE\u7B54\u306F\u8A18\u9332\u3057\u307E\u3057\u305F\u3002\u6848\u4EF6\u306E\u72B6\u614B\u5909\u66F4\u306B\u306F\u672C\u90E8\u3067\u306E\u56DE\u7B54\u6A29\u9650\u767B\u9332\u304C\u5FC5\u8981\u3067\u3059\u3002 / Reply recorded. HQ must authorize your response access." : result.error === "hq_review_required" ? "\u672C\u90E8\u78BA\u8A8D\u5F85\u3061\u3067\u3059\u3002\u672C\u90E8\u306F\u300C\u6848\u4EF6\u756A\u53F7 \u627F\u8A8D\u3057\u3066\u7D42\u4E86 \u7406\u7531\u300D\u307E\u305F\u306F\u300C\u6848\u4EF6\u756A\u53F7 \u5DEE\u3057\u623B\u3057 \u7406\u7531\u300D\u3067\u56DE\u7B54\u3057\u3066\u304F\u3060\u3055\u3044\u3002 / Awaiting HQ approval or return." : result.error === "closed_case" ? "\u3053\u306E\u6848\u4EF6\u306F\u5B8C\u4E86\u6E08\u307F\u3067\u3059\u3002 / This case is already closed." : result.not_found ? "\u6848\u4EF6\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u901A\u77E5\u306E\u6848\u4EF6\u756A\u53F7\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002 / Check the case number." : replyHelp(result.code || parsed.code);
              await timed("https://api.line.me/v2/bot/message/reply", { method: "POST", headers: { Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN"), "Content-Type": "application/json" }, body: JSON.stringify({ replyToken: e.replyToken, messages: [{ type: "text", text: message.slice(0, 4900), ...result.id && result.status === "hq_review" ? { quickReply: { items: [["\u627F\u8A8D / Approve", "\u627F\u8A8D\u3057\u3066\u7D42\u4E86"], ["\u5DEE\u3057\u623B\u3057 / Return", "\u5DEE\u3057\u623B\u3057"]].map(([label, cmd]) => ({ type: "action", action: { type: "postback", label, data: "case_reply=" + encodeURIComponent(result.code), inputOption: "openKeyboard", fillInText: result.code + " " + cmd + " " } })) } } : {} }] }) });
            }
          } else await rpc("bot_ingest", { p_event_id: e.webhookEventId, p_group: g, p_user: e.source?.userId || "", p_text: text, p_type: e.type });
        }
        return json({ ok: true });
      }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      if (body.action === "worker") {
        const cfg = await setting("worker");
        if (!cfg?.key || req.headers.get("x-bot-worker-key") !== cfg.key) throw Error("unauthorized");
        if (body.mode === "group_directory") return json(await groupDirectory());
        if (body.mode === "morning_preview") return json(await morningSummary(body.variant || "daily", true));
        if (!cfg.enabled || !await setting("clock")) return json({ skipped: true });
        if (body.mode === "morning_summary" && Object.hasOwn(body, "category")) {
          if (!["labor", "finance", "cash_tip"].includes(body.category)) throw Error("invalid_report_category");
          return json(await morningSummary(body.variant || "daily", false, body.category));
        }
        await flushCaseNotices();
        if (body.mode === "morning_summary") return json(await morningSummary(body.variant || "daily"));
        if (body.mode !== "monitor" && (await setting("collection_range"))?.mode === "month_to_yesterday") return json(await rangeRun(String(body.store_id)));
        const date = new Date(Date.now() - 10 * 36e5 - 864e5).toISOString().slice(0, 10);
        const result = body.mode === "monitor" ? {} : await scan(String(body.store_id), date, null, cfg.finance_enabled === true);
        const start = Date.now(), pending = await db("bot_cases?kind=in.(labor,void,unpaid)&status=not.in.(done,hq_review)&or=" + encodeURIComponent("(kind.neq.void,payload->>scope.eq.payment)") + "&store_id=eq." + encodeURIComponent(body.store_id) + "&order=last_checked_at.asc.nullsfirst,created_at.asc&limit=20");
        let checked = 0, verified = 0;
        for (const c2 of pending) {
          if (Date.now() - start > 45e3) break;
          try {
            if ((await recheck(c2, null)).clean) verified++;
          } catch {
          }
          checked++;
        }
        await flushCaseNotices();
        return json({ ...result, checked, verified });
      }
      const actor = await authorize(req);
      if (body.action === "daily") return json(await dailyOverview(body.after));
      if (body.action === "list") return json({ actor, daily: await dailyOverview(), cases: await db("bot_cases?or=" + encodeURIComponent("(kind.neq.void,payload->>scope.eq.payment)") + "&order=updated_at.desc&limit=200"), groups: await db("bot_groups?order=group_id"), line_candidates: await db("bot_settings?key=like.line_candidate:*&select=key,value"), line_links: await db("bot_settings?key=like.line_link:*&select=key,value"), line_responders: await db("bot_settings?key=like.line_responder:*&select=key,value"), closure_rules: await setting("closure_rules"), owners: await db("bot_settings?key=like.owner:*&select=key,value"), intakes: await db("bot_events?kind=eq.line_needs_store&case_id=is.null&order=id.asc&limit=50"), runs: await db("bot_runs"), clock: await setting("clock"), worker_enabled: !!(await setting("worker"))?.enabled, finance_enabled: !!(await setting("worker"))?.finance_enabled, line: { secret: !!env("LINE_CHANNEL_SECRET"), token: !!env("LINE_CHANNEL_ACCESS_TOKEN") }, stores: await db("store_config?active=eq.true&select=store_id,name") });
      if (body.action === "resolve_send") {
        if (!APPROVERS.includes(actor.role) || !UUID.test(body.outbox_id || "")) throw Error("forbidden");
        await rpc("bot_resolve_send", { p_actor: actor.id, p_id: body.outbox_id, p_state: body.state, p_note: String(body.note || "").trim() });
        return json({ ok: true });
      }
      if (body.action === "detail") {
        if (!UUID.test(body.id || "")) throw Error("invalid_id");
        return json({ events: await db("bot_events?case_id=eq." + body.id + "&order=id.desc&limit=100"), outbox: await db("bot_outbox?case_id=eq." + body.id + "&order=created_at.desc&limit=20") });
      }
      if (body.action === "config") {
        if (!["gm", "ceo"].includes(actor.role)) throw Error("forbidden");
        const clock = validConfig(body.clock);
        await db("bot_settings?on_conflict=key", "POST", { key: "clock", value: clock, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, "resolution=merge-duplicates");
        return json({ clock });
      }
      if (body.action === "worker_config") {
        if (!["gm", "ceo"].includes(actor.role)) throw Error("forbidden");
        const c2 = await setting("worker");
        if (!c2) throw Error("worker_not_configured");
        await db("bot_settings?key=eq.worker", "PATCH", { value: { ...c2, enabled: typeof body.enabled === "boolean" ? body.enabled : !!c2.enabled, finance_enabled: typeof body.finance_enabled === "boolean" ? body.finance_enabled : !!c2.finance_enabled }, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
        return json({ enabled: typeof body.enabled === "boolean" ? body.enabled : !!c2.enabled, finance_enabled: typeof body.finance_enabled === "boolean" ? body.finance_enabled : !!c2.finance_enabled });
      }
      if (body.action === "closure_rules") {
        if (!["gm", "ceo"].includes(actor.role)) throw Error("forbidden");
        const c2 = body.rules;
        if (!c2 || ["finance_hq", "unchanged_hq", "other_hq", "labor_fixed_hq"].some((k) => typeof c2[k] !== "boolean") || !Number.isFinite(c2.finance_threshold) || c2.finance_threshold < 0) throw Error("invalid_config");
        await db("bot_settings?on_conflict=key", "POST", { key: "closure_rules", value: { finance_hq: c2.finance_hq, unchanged_hq: c2.unchanged_hq, other_hq: c2.other_hq, labor_fixed_hq: c2.labor_fixed_hq, finance_threshold: c2.finance_threshold }, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, "resolution=merge-duplicates");
        return json({ ok: true });
      }
      if (body.action === "responder_profile") {
        if (!APPROVERS.includes(actor.role)) throw Error("forbidden");
        const candidate = await setting("line_candidate:" + body.group_id + ":" + body.user_id);
        if (!candidate) throw Error("registration_required");
        const profile = await lineMember(body.group_id, body.user_id);
        return json({ profile: { display_name: profile.displayName } });
      }
      if (body.action === "line_responder") {
        if (!APPROVERS.includes(actor.role)) throw Error("forbidden");
        if (!/^C[a-f0-9]{32}$/i.test(body.group_id || "") || !/^U[a-f0-9]{32}$/i.test(body.user_id || "")) throw Error("invalid_line_user");
        const key = "line_responder:" + body.group_id + ":" + body.user_id;
        if (body.remove === true) {
          await db("bot_settings?key=eq." + encodeURIComponent(key), "DELETE");
          return json({ ok: true });
        }
        if (!["manager", "hq"].includes(body.role) || body.role === "hq" && !["gm", "ceo"].includes(actor.role)) throw Error("forbidden");
        const candidate = await setting("line_candidate:" + body.group_id + ":" + body.user_id);
        if (!candidate) throw Error("registration_required");
        const groups = await db("bot_groups?group_id=eq." + body.group_id + "&enabled=eq.true");
        if (groups.length !== 1) throw Error("group_not_enabled");
        const stores = Array.isArray(body.stores) ? [...new Set(body.stores)] : [];
        if (body.role === "manager" && !stores.length) throw Error("invalid_store");
        for (const id of stores) {
          await getStore(id);
          if (!groups[0].all_stores && groups[0].store_id !== id) throw Error("forbidden");
        }
        const profile = await lineMember(body.group_id, body.user_id);
        if (body.display_name !== profile.displayName) throw Error("mention_link_changed");
        await db("bot_settings?on_conflict=key", "POST", { key, value: { group_id: body.group_id, user_id: body.user_id, display_name: profile.displayName, role: body.role, stores, enabled: true, approved_by: actor.id, approved_at: (/* @__PURE__ */ new Date()).toISOString() }, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, "resolution=merge-duplicates");
        return json({ ok: true });
      }
      if (body.action === "line_link" || body.action === "line_profile") {
        if (!APPROVERS.includes(actor.role)) throw Error("forbidden");
        await getStore(body.store_id);
        const groups = await db("bot_groups?group_id=eq." + encodeURIComponent(body.group_id) + "&enabled=eq.true");
        if (groups.length !== 1 || !groups[0].all_stores && groups[0].store_id !== body.store_id) throw Error("group_not_enabled");
        const key = "line_link:" + body.group_id + ":" + body.store_id;
        if (body.remove === true) {
          await db("bot_settings?key=eq." + encodeURIComponent(key), "DELETE");
          return json({ ok: true });
        }
        const candidate = await setting("line_candidate:" + body.group_id + ":" + body.user_id);
        if (!candidate) throw Error("registration_required");
        const owner = await setting("owner:" + body.store_id);
        if (!owner?.name || owner.name !== body.assignee) throw Error("mention_link_changed");
        const profile = await lineMember(body.group_id, body.user_id);
        if (body.action === "line_profile") return json({ profile: { user_id: profile.userId, display_name: profile.displayName } });
        if (body.display_name !== profile.displayName) throw Error("mention_link_changed");
        const value = { group_id: body.group_id, store_id: body.store_id, user_id: body.user_id, assignee: owner.name, display_name: profile.displayName, approved_by: actor.id, approved_at: (/* @__PURE__ */ new Date()).toISOString() };
        await db("bot_settings?on_conflict=key", "POST", { key, value, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, "resolution=merge-duplicates");
        return json({ ok: true, link: value });
      }
      if (body.action === "owner") {
        if (!APPROVERS.includes(actor.role)) throw Error("forbidden");
        await getStore(body.store_id);
        const name = String(body.name || "").trim();
        if (!name || name.length > 120 || /[\r\n]/.test(name)) throw Error("assignee_required");
        await db("bot_settings?on_conflict=key", "POST", { key: "owner:" + body.store_id, value: { name }, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, "resolution=merge-duplicates");
        return json({ ok: true });
      }
      if (body.action === "assign_intake") {
        if (!Number.isSafeInteger(body.event_id) || body.event_id <= 0) throw Error("invalid_id");
        return json(await rpc("bot_assign_intake", { p_actor: actor.id, p_event: body.event_id, p_store: body.store_id }));
      }
      if (body.action === "group") {
        if (!["gm", "ceo"].includes(actor.role)) throw Error("forbidden");
        if (body.all_stores !== true) await getStore(body.store_id);
        if (!/^C[a-f0-9]{32}$/i.test(body.group_id || "")) throw Error("invalid_group");
        await db("bot_groups?on_conflict=group_id", "POST", { group_id: body.group_id, store_id: body.all_stores === true ? null : body.store_id, all_stores: body.all_stores === true, label: String(body.label || "").slice(0, 120), enabled: body.enabled === true, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, "resolution=merge-duplicates");
        return json({ ok: true });
      }
      if (body.action === "scan") return json(await scan(String(body.store_id), businessDate(body.date), actor.id, body.with_voids === true));
      if (body.action === "create_purchase") {
        const store = await getStore(body.store_id);
        if (!UUID.test(body.request_id || "")) throw Error("invalid_request_id");
        const subject = String(body.subject || "").trim();
        if (!subject || subject.length > 160) throw Error("subject_required");
        return json(await rpc("bot_case_write", { p_op: "finding", p_actor: actor.id, p_data: { source_key: "manual:" + body.request_id, kind: "purchase", store_id: store.store_id, business_date: new Date(Date.now() - 10 * 36e5).toISOString().slice(0, 10), subject, payload: { request: String(body.request || subject).slice(0, 5e3), source: "manual" } } }));
      }
      if (!UUID.test(body.id || "") || !Number.isInteger(body.version)) throw Error("invalid_id_or_version");
      const rows = await db("bot_cases?id=eq." + body.id);
      if (rows.length !== 1) throw Error("not_found");
      const c = rows[0];
      if (body.action === "send") return json(await send(c, actor, body));
      if (c.version !== body.version) throw Error("conflict");
      if (body.action === "respond") return json(await rpc("bot_case_respond", { p_id: c.id, p_version: c.version, p_action: body.response, p_note: String(body.note || "").trim(), p_actor: actor.id, p_due: body.due_date || null }));
      if (body.action === "recheck") return json(await recheck(c, actor.id));
      const ops = ["assign", "note", "draft", "correction", "reported", "acknowledge", "purchase", "approve", "ordered"];
      if (!ops.includes(body.action)) throw Error("bad_action");
      const data = { assignee: String(body.assignee || "").trim(), note: String(body.note || "").trim(), draft: String(body.draft || "").trim(), order_number: String(body.order_number || "").trim() };
      if (body.action === "assign" && /[\r\n]/.test(data.assignee)) throw Error("assignee_required");
      if (body.action === "purchase") {
        data.url = safePurchaseURL(body.url);
        data.quantity = Number(body.quantity);
        if (!Number.isFinite(data.quantity) || data.quantity <= 0 || data.quantity > 1e5) throw Error("invalid_quantity");
      }
      return json(await rpc("bot_case_write", { p_op: body.action, p_actor: actor.id, p_id: c.id, p_version: body.version, p_data: data }));
    } catch (e) {
      const code = e instanceof SyntaxError ? "invalid_json" : e.message || "request_failed";
      const status = code === "unauthorized" ? 401 : code === "forbidden" ? 403 : ["conflict", "send_unresolved", "scan_busy"].includes(code) ? 409 : code.includes("missing") || code.includes("not_configured") ? 503 : 400;
      return json({ error: /^[a-z_]+$/.test(code) ? code : "request_failed" }, status);
    }
  };
}

// supabase/functions/ops-bot/index.ts
Deno.serve(createHandler({ env: (key) => Deno.env.get(key) }));
