const DB_KEY = "suishou-ledger.records.v1";
const PREF_KEY = "suishou-ledger.prefs.v1";
const EXTRAS_KEY = "suishou-ledger.extras.v1";
const CLOUD_META_KEY = "suishou-ledger.cloud-meta.v1";
const DRIVE_CLIENT_ID =
  "623321438376-t93joh0ms0fb806lp043k9mrub8o3f6c.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FILE_NAME = "随手账本-云端同步.json";
const CURRENCIES = [
  { code: "CNY", name: "人民币", digits: 2 },
  { code: "USD", name: "美元", digits: 2 },
  { code: "EUR", name: "欧元", digits: 2 },
  { code: "HKD", name: "港币", digits: 2 },
  { code: "JPY", name: "日元", digits: 0 },
  { code: "GBP", name: "英镑", digits: 2 },
  { code: "TWD", name: "新台币", digits: 0 },
  { code: "KRW", name: "韩元", digits: 0 },
  { code: "SGD", name: "新加坡元", digits: 2 },
];
const CATEGORY = {
  expense: [
    { name: "餐饮美食", icon: "☕", color: "#ef936f", bg: "#fff0e8" },
    { name: "日常购物", icon: "◈", color: "#806cea", bg: "#f1edff" },
    { name: "交通出行", icon: "↗", color: "#5a96db", bg: "#eaf4ff" },
    { name: "住房水电", icon: "⌂", color: "#41aaa7", bg: "#e6f8f5" },
    { name: "娱乐休闲", icon: "✦", color: "#d17fb9", bg: "#fff0fa" },
    { name: "学习教育", icon: "▤", color: "#7899df", bg: "#ebf1ff" },
    { name: "医疗健康", icon: "✚", color: "#e17584", bg: "#ffeff1" },
    { name: "数码电子", icon: "▣", color: "#7286ae", bg: "#edf1f8" },
    { name: "旅行住宿", icon: "✈", color: "#d5a44f", bg: "#fff6e5" },
    { name: "其他支出", icon: "···", color: "#8b95a5", bg: "#f0f2f6" },
  ],
  income: [
    { name: "工资薪酬", icon: "▤", color: "#35a68b", bg: "#e9f8f2" },
    { name: "兼职收入", icon: "✦", color: "#629ed3", bg: "#eaf4fe" },
    { name: "投资理财", icon: "↗", color: "#8d78d2", bg: "#f3efff" },
    { name: "礼物红包", icon: "♡", color: "#e48691", bg: "#fff1f3" },
    { name: "转账收入", icon: "⇄", color: "#c9a358", bg: "#fff6e3" },
    { name: "退款返还", icon: "↩", color: "#479ead", bg: "#e9f7fa" },
    { name: "其他收入", icon: "···", color: "#8b95a5", bg: "#f0f2f6" },
  ],
};

const moneyDef = (code) =>
  CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
function money(minor, currency) {
  const def = moneyDef(currency);
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: def.code,
    minimumFractionDigits: def.digits,
    maximumFractionDigits: def.digits,
  }).format(minor / 10 ** def.digits);
}
function parseMoney(value, currency) {
  const digits = moneyDef(currency).digits;
  const s = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 1000000000000)
    return null;
  return minor;
}
// Request latest published reference rate, never send membership names or amounts to a server.
// Daily reference rates are NOT a bank's real-time settlement rates.
const fxCache = new Map(),
  fxPending = new Map(),
  fxErrors = new Map();
const FX_SOURCE = "https://api.frankfurter.dev";
function estimateCny(amountMinor, code, rate) {
  return Math.round((amountMinor / 10 ** moneyDef(code).digits) * rate * 100);
}
function readableRate(rate) {
  return Number(rate).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}
async function getCnyRate(code, force = false) {
  if (code === "CNY")
    return {
      rate: 1,
      date: localDatetime().slice(0, 10),
      fetchedAt: new Date().toISOString(),
      source: "人民币原价",
    };
  if (!CURRENCIES.some((c) => c.code === code)) throw new Error("不支持的币种");
  const cached = fxCache.get(code);
  if (
    !force &&
    cached &&
    Date.now() - new Date(cached.fetchedAt).getTime() < 10 * 60 * 1000
  )
    return cached;
  if (fxPending.has(code)) return fxPending.get(code);
  const task = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(
        `${FX_SOURCE}/v2/rate/${encodeURIComponent(code)}/CNY`,
        { mode: "cors", cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (
        data.base !== code ||
        data.quote !== "CNY" ||
        !Number.isFinite(data.rate) ||
        data.rate <= 0 ||
        data.rate > 100000 ||
        !validDate(data.date)
      )
        throw new Error("汇率数据格式不正确");
      const snap = {
        rate: data.rate,
        date: data.date,
        fetchedAt: new Date().toISOString(),
        source: "Frankfurter",
      };
      fxCache.set(code, snap);
      fxErrors.delete(code);
      return snap;
    } catch (err) {
      fxErrors.set(code, "获取汇率失败，请检查网络");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  })();
  fxPending.set(code, task);
  try {
    return await task;
  } finally {
    fxPending.delete(code);
  }
}
function fxLabel(minor, code) {
  if (code === "CNY") return "";
  const snap = fxCache.get(code);
  if (!snap)
    return fxErrors.has(code)
      ? "汇率暂不可用 · 可稍后重试"
      : "正在获取人民币参考汇率…";
  return `≈ ${money(estimateCny(minor, code, snap.rate), "CNY")} · 1 ${code} ≈ ¥${readableRate(snap.rate)} · 汇率 ${snap.date}`;
}
function getCategoryInfo(type, name) {
  return (
    CATEGORY[type]?.find((c) => c.name === name) || {
      name,
      icon: "···",
      color: "#8b95a5",
      bg: "#f1f2f7",
    }
  );
}
function localDatetime(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
function localMonth(date = new Date()) {
  return localDatetime(date).slice(0, 7);
}
function makeId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
function validateRecords(records) {
  if (!Array.isArray(records) || records.length > 50000)
    throw new Error("备份文件记录数量无效");
  const seen = new Set();
  return records.map((r) => {
    if (
      !r ||
      typeof r !== "object" ||
      typeof r.id !== "string" ||
      r.id.length > 100 ||
      seen.has(r.id)
    )
      throw new Error("备份中的记录标识不正确");
    seen.add(r.id);
    if (!["expense", "income"].includes(r.type))
      throw new Error("备份中收支类型不正确");
    if (!CURRENCIES.some((c) => c.code === r.currency))
      throw new Error("备份中包含不支持的币种");
    if (
      !Number.isSafeInteger(r.amountMinor) ||
      r.amountMinor <= 0 ||
      r.amountMinor > 1000000000000
    )
      throw new Error("备份中的金额不正确");
    if (
      typeof r.category !== "string" ||
      !CATEGORY[r.type].some((c) => c.name === r.category)
    )
      throw new Error("备份中的分类不正确");
    if (typeof r.name !== "string" || r.name.length > 80)
      throw new Error("备份中的名称不正确");
    if (
      typeof r.occurredAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.occurredAt) ||
      Number.isNaN(new Date(r.occurredAt).getTime())
    )
      throw new Error("备份中的日期不正确");
    if (
      r.paymentCardId !== undefined &&
      (typeof r.paymentCardId !== "string" || r.paymentCardId.length > 100)
    )
      throw new Error("备份中的储值卡引用不正确");
    if (
      r.membershipId !== undefined &&
      (typeof r.membershipId !== "string" || r.membershipId.length > 100)
    )
      throw new Error("备份中会员关联不正确");
    let fx = null;
    if (r.fx !== undefined) {
      const f = r.fx;
      if (
        !f ||
        typeof f !== "object" ||
        r.currency !== "CNY" ||
        !CURRENCIES.some((c) => c.code === f.originalCurrency) ||
        !Number.isSafeInteger(f.originalAmountMinor) ||
        f.originalAmountMinor <= 0 ||
        f.originalAmountMinor > 1000000000000 ||
        typeof f.rate !== "number" ||
        !Number.isFinite(f.rate) ||
        f.rate <= 0 ||
        f.rate > 100000 ||
        typeof f.rateDate !== "string" ||
        !validDate(f.rateDate) ||
        !["Frankfurter", "实际扣款", "人民币原价"].includes(f.source) ||
        typeof f.capturedAt !== "string" ||
        f.capturedAt.length > 40
      )
        throw new Error("备份中的换汇记录不正确");
      fx = {
        originalCurrency: f.originalCurrency,
        originalAmountMinor: f.originalAmountMinor,
        rate: f.rate,
        rateDate: f.rateDate,
        source: f.source,
        capturedAt: f.capturedAt,
      };
    }
    return {
      id: r.id,
      type: r.type,
      category: r.category,
      name: r.name,
      currency: r.currency,
      amountMinor: r.amountMinor,
      occurredAt: r.occurredAt,
      createdAt:
        typeof r.createdAt === "string"
          ? r.createdAt
          : new Date().toISOString(),
      ...(r.type === "expense" && r.paymentCardId
        ? { paymentCardId: r.paymentCardId }
        : {}),
      ...(r.type === "expense" && r.membershipId
        ? { membershipId: r.membershipId }
        : {}),
      ...(fx && r.type === "expense" ? { fx } : {}),
    };
  });
}
function readLocal(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s === null ? fallback : JSON.parse(s);
  } catch (e) {
    console.warn("读取失败", e);
    return fallback;
  }
}
function validDate(value) {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  return (
    parsed.getFullYear() === y &&
    parsed.getMonth() === m - 1 &&
    parsed.getDate() === d
  );
}
function validateCards(input) {
  if (!Array.isArray(input) || input.length > 100)
    throw new Error("储值卡数量不正确");
  const ids = new Set();
  return input.map((c) => {
    if (
      !c ||
      typeof c !== "object" ||
      typeof c.id !== "string" ||
      c.id.length > 100 ||
      ids.has(c.id)
    )
      throw new Error("储值卡标识不正确");
    ids.add(c.id);
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 40)
      throw new Error("储值卡名称不正确");
    if (!CURRENCIES.some((x) => x.code === c.currency))
      throw new Error("储值卡币种不正确");
    if (
      !Number.isSafeInteger(c.balanceMinor) ||
      c.balanceMinor < 0 ||
      c.balanceMinor > 1000000000000
    )
      throw new Error("储值卡余额不正确");
    return {
      id: c.id,
      name: c.name.trim(),
      currency: c.currency,
      balanceMinor: c.balanceMinor,
    };
  });
}
function validateMemberships(input) {
  if (!Array.isArray(input) || input.length > 500)
    throw new Error("订阅数量不正确");
  const ids = new Set();
  return input.map((m) => {
    if (
      !m ||
      typeof m !== "object" ||
      typeof m.id !== "string" ||
      m.id.length > 100 ||
      ids.has(m.id)
    )
      throw new Error("会员标识不正确");
    ids.add(m.id);
    if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 50)
      throw new Error("会员平台名称不正确");
    if (!CURRENCIES.some((c) => c.code === m.currency))
      throw new Error("会员币种不正确");
    if (
      !Number.isSafeInteger(m.amountMinor) ||
      m.amountMinor <= 0 ||
      m.amountMinor > 1000000000000
    )
      throw new Error("会员费用不正确");
    if (
      !["month", "quarter", "year", "once"].includes(m.cycle) ||
      !validDate(m.nextDate)
    )
      throw new Error("会员周期或日期不正确");
    if (typeof m.note !== "string" || m.note.length > 100)
      throw new Error("会员备注不正确");
    if (typeof m.active !== "boolean" || typeof m.autoRenew !== "boolean")
      throw new Error("会员状态不正确");
    return {
      id: m.id,
      name: m.name.trim(),
      currency: m.currency,
      amountMinor: m.amountMinor,
      cycle: m.cycle,
      nextDate: m.nextDate,
      active: m.active,
      autoRenew: m.autoRenew,
      note: m.note,
    };
  });
}
function parseNonnegativeMoney(value, currency) {
  const digits = moneyDef(currency).digits,
    s = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > digits) return null;
  const amount =
    Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0"));
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1000000000000
    ? amount
    : null;
}

const savedPrefs = readLocal(PREF_KEY, {});
let storageError = "";
function loadData(key, read, fallback) {
  try {
    return read(JSON.parse(localStorage.getItem(key)) ?? fallback);
  } catch (error) {
    console.error("本地数据读取失败", error);
    storageError = "本地数据存在异常。请先检查原始数据或从备份恢复。";
    return read(fallback);
  }
}

const extrasFallback = { cards: [], memberships: [] };
const loadLedger = () => ({
  records: loadData(DB_KEY, validateRecords, []),
  ...loadData(
    EXTRAS_KEY,
    (data) => {
      if (typeof data !== "object" || Array.isArray(data))
        throw new Error("附加数据格式无效");
      return {
        cards: validateCards(data.cards ?? []),
        memberships: validateMemberships(data.memberships ?? []),
      };
    },
    extrasFallback,
  ),
});
const state = {
  ...loadLedger(),
  statsCurrency: CURRENCIES.some(
    (currency) => currency.code === savedPrefs?.statsCurrency,
  )
    ? savedPrefs.statsCurrency
    : "CNY",
  cloudMessage: "本地账本 · 尚未连接 Google Drive",
  cloudStatus: "idle",
  cloudReady: false,
};

const listeners = new Set();
let snapshot = { ...state, storageError };
function notify() {
  snapshot = { ...state, storageError };
  for (const listener of listeners) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => snapshot;

function saveCurrency(currency) {
  state.statsCurrency = currency;
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ statsCurrency: currency }));
  } catch (_) {
    /* Preference persistence is optional. */
  }
  notify();
}

// These keys and payloads are shared with the previous static app.
function persist(data, meta) {
  const entries = [
    [DB_KEY, JSON.stringify(data.records)],
    [
      EXTRAS_KEY,
      JSON.stringify({ cards: data.cards, memberships: data.memberships }),
    ],
  ];
  if (meta) entries.push([CLOUD_META_KEY, JSON.stringify(meta)]);
  const previous = entries.map(([key]) => [key, localStorage.getItem(key)]);
  try {
    for (const [key, value] of entries) localStorage.setItem(key, value);
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (_) {
        /* Keep trying to restore the remaining keys. */
      }
    }
    throw error;
  }
}

function commit(changes, recovering = false) {
  if (storageError && !recovering) throw new Error(storageError);
  const next = { ...state, ...changes };
  const meta = stampLocalChanges(next);
  try {
    persist(next, meta);
  } catch (_) {
    throw new Error("无法保存本地数据，请检查浏览器的可用空间。");
  }
  Object.assign(state, changes);
  if (recovering) storageError = "";
  cloudMeta = meta;
  cloudBaseline = currentData();
  cloudSeq++;
  if (cloud.ready) scheduleCloudSync(750);
  notify();
}

// PRIVATE CLOUD SYNC: The access token stays in memory. No token, private data,
// client secret or credentials are committed to GitHub. Google Drive stores one
// visible JSON file created with drive.file access.
const CLOUD_TYPES = ["records", "cards", "memberships"];
const emptyCloudMeta = () => {
  const emptySet = () =>
    Object.fromEntries(CLOUD_TYPES.map((type) => [type, Object.create(null)]));
  return { versions: emptySet(), deleted: emptySet() };
};
function sanitizeMeta(raw) {
  const out = emptyCloudMeta();
  for (const part of ["versions", "deleted"])
    for (const kind of CLOUD_TYPES) {
      const items = raw?.[part]?.[kind];
      if (!items || typeof items !== "object" || Array.isArray(items)) continue;
      for (const [id, stamp] of Object.entries(items)) {
        if (id.length > 100 || !stamp || typeof stamp !== "object") continue;
        if (
          Number.isSafeInteger(stamp.time) &&
          stamp.time >= 0 &&
          stamp.time < 9000000000000000 &&
          typeof stamp.origin === "string" &&
          stamp.origin.length <= 100
        )
          out[part][kind][id] = { time: stamp.time, origin: stamp.origin };
      }
    }
  return out;
}
const CLOUD_ORIGIN_KEY = "suishou-ledger.cloud-device.v1";
let cloudOrigin = "";
try {
  cloudOrigin = localStorage.getItem(CLOUD_ORIGIN_KEY) || makeId();
  localStorage.setItem(CLOUD_ORIGIN_KEY, cloudOrigin);
} catch (_) {
  cloudOrigin = makeId();
}
let cloudMeta = sanitizeMeta(readLocal(CLOUD_META_KEY, null));
let cloudBaseline = currentData();
let cloudSeq = 0;
const cloud = {
  token: "",
  expiresAt: 0,
  fileId: "",
  fileVersion: "",
  ready: false,
  busy: false,
  queued: false,
  initialized: false,
  timer: null,
  tokenClient: null,
  authPrompt: false,
  lastSync: 0,
};
function currentData() {
  return {
    records: state.records,
    cards: state.cards,
    memberships: state.memberships,
  };
}
function sameContent(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function cloudStamp() {
  return { time: Date.now(), origin: cloudOrigin };
}
function compareStamps(a, b) {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  return a.time - b.time || a.origin.localeCompare(b.origin);
}
function ensureCloudVersions(data, meta) {
  for (const kind of CLOUD_TYPES)
    for (const item of data[kind]) {
      const prev = meta.versions[kind][item.id],
        del = meta.deleted[kind][item.id];
      if (prev) continue;
      let t = kind === "records" ? Date.parse(item.createdAt || "") || 1 : 1;
      t = Math.max(1, Math.min(Date.now(), t));
      meta.versions[kind][item.id] =
        compareStamps({ time: t, origin: "legacy" }, del) > 0
          ? { time: t, origin: "legacy" }
          : del;
    }
}
ensureCloudVersions(cloudBaseline, cloudMeta);
function stampLocalChanges(after) {
  const meta = sanitizeMeta(cloudMeta);
  const stamp = cloudStamp();
  for (const kind of CLOUD_TYPES) {
    const beforeIds = new Map(
      cloudBaseline[kind].map((item) => [item.id, item]),
    );
    const afterIds = new Map(after[kind].map((item) => [item.id, item]));
    for (const item of after[kind]) {
      const prior = beforeIds.get(item.id);
      if (!prior || !sameContent(prior, item)) {
        meta.versions[kind][item.id] = stamp;
        delete meta.deleted[kind][item.id];
      }
    }
    for (const item of cloudBaseline[kind])
      if (!afterIds.has(item.id)) {
        meta.deleted[kind][item.id] = stamp;
        delete meta.versions[kind][item.id];
      }
  }
  return meta;
}

function cloudStateLabel(message, kind = "idle") {
  state.cloudMessage = message.replace(/^☁ /, "");
  state.cloudStatus = kind;
  state.cloudReady = cloud.ready;
  notify();
}
function localCloudPack() {
  const data = currentData();
  const meta = sanitizeMeta(cloudMeta);
  ensureCloudVersions(data, meta);
  return {
    app: "随手账本",
    syncVersion: 1,
    savedAt: new Date().toISOString(),
    records: data.records,
    cards: data.cards,
    memberships: data.memberships,
    meta,
  };
}
function checkedCloudPack(json) {
  if (!json || json.app !== "随手账本" || json.syncVersion !== 1)
    throw new Error("云端文件内容不属于随手账本同步格式，已停止上传以防覆盖");
  const records = validateRecords(json.records),
    cards = validateCards(json.cards),
    memberships = validateMemberships(json.memberships);
  const meta = sanitizeMeta(json.meta);
  const data = { records, cards, memberships };
  ensureCloudVersions(data, meta);
  return {
    app: "随手账本",
    syncVersion: 1,
    savedAt: json.savedAt || "",
    ...data,
    meta,
  };
}
function mergeCloudPacks(local, remote) {
  const base = {
    app: "随手账本",
    syncVersion: 1,
    savedAt: new Date().toISOString(),
    records: [],
    cards: [],
    memberships: [],
    meta: emptyCloudMeta(),
  };
  for (const kind of CLOUD_TYPES) {
    const left = new Map(local[kind].map((x) => [x.id, x]));
    const right = new Map(remote[kind].map((x) => [x.id, x]));
    const ids = new Set([
      ...left.keys(),
      ...right.keys(),
      ...Object.keys(local.meta.deleted[kind]),
      ...Object.keys(remote.meta.deleted[kind]),
    ]);
    for (const id of ids) {
      const lv = local.meta.versions[kind][id],
        rv = remote.meta.versions[kind][id],
        ld = local.meta.deleted[kind][id],
        rd = remote.meta.deleted[kind][id];
      const version = compareStamps(lv, rv) >= 0 ? lv : rv;
      const deleted = compareStamps(ld, rd) >= 0 ? ld : rd;
      if (deleted && compareStamps(deleted, version) >= 0) {
        base.meta.deleted[kind][id] = deleted;
        continue;
      }
      if (!version) continue;
      const side = compareStamps(lv, rv) >= 0 ? "local" : "remote";
      const item =
        (side === "local" ? left : right).get(id) ||
        (side === "local" ? right : left).get(id);
      if (item) {
        base[kind].push(item);
        base.meta.versions[kind][id] = version;
      }
    }
  }
  return base;
}
function packComparable(pack) {
  const meta = emptyCloudMeta();
  for (const part of ["versions", "deleted"])
    for (const kind of CLOUD_TYPES) {
      meta[part][kind] = Object.fromEntries(
        Object.entries(pack.meta[part][kind]).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
  return JSON.stringify({
    records: [...pack.records].sort((a, b) => a.id.localeCompare(b.id)),
    cards: [...pack.cards].sort((a, b) => a.id.localeCompare(b.id)),
    memberships: [...pack.memberships].sort((a, b) => a.id.localeCompare(b.id)),
    meta,
  });
}

function persistCloudMerge(pack) {
  try {
    if (storageError) throw new Error(storageError);
    persist(pack, pack.meta);
  } catch (_) {
    cloudStateLabel("本地保存失败，请检查空间并导出备份", "warning");
    return false;
  }
  state.records = pack.records;
  state.cards = pack.cards;
  state.memberships = pack.memberships;
  cloudMeta = pack.meta;
  cloudBaseline = currentData();
  notify();
  return true;
}
function driveHeaders(json = false) {
  return {
    Authorization: "Bearer " + cloud.token,
    ...(json ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
  };
}
async function driveRequest(url, options = {}) {
  if (!navigator.onLine) throw new Error("网络未连接，数据保存在本地");
  if (!cloud.token || Date.now() > cloud.expiresAt - 30000)
    throw new Error("Google 授权已过期，请点击「重连」继续同步");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...driveHeaders(), ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      let errBody = "";
      try {
        errBody = (await res.clone().json())?.error?.message || "";
      } catch (_) {}
      if (res.status === 401) throw new Error("Google 授权已过期，请重新连接");
      throw new Error(
        "Google Drive 权限不足：" +
          (errBody || "请确认已启用 Drive API 和授权 drive.file 权限"),
      );
    }
    if (!res.ok) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 160);
      } catch (_) {}
      throw new Error("Drive 请求失败 (" + res.status + ") " + body);
    }
    return res.status === 204 ? null : await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("请求超时，请检查网络");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
const DRIVE_API = "https://www.googleapis.com/drive/v3";
async function findCloudFile() {
  if (cloud.fileId) return cloud.fileId;
  const q = "name = '" + DRIVE_FILE_NAME + "' and trashed = false";
  const url =
    DRIVE_API +
    "/files?" +
    new URLSearchParams({
      q,
      fields: "nextPageToken,files(id,name,mimeType,version,modifiedTime)",
      pageSize: "100",
      spaces: "drive",
    });
  const data = await driveRequest(url);
  const matches = (data.files || []).filter(
    (x) => x.name === DRIVE_FILE_NAME && x.mimeType === "application/json",
  );
  if (data.nextPageToken || matches.length > 1)
    throw new Error(
      "找到多个同名云端账本或列表未完整，请先在 Drive 中检查，避免误覆盖",
    );
  if (matches.length) {
    cloud.fileId = matches[0].id;
    cloud.fileVersion = matches[0].version || "";
    return cloud.fileId;
  }
  return null;
}
async function createCloudFile(pack) {
  const boundary = "ledgerSync" + Math.random().toString(36).slice(2);
  const metadata = {
    name: DRIVE_FILE_NAME,
    mimeType: "application/json",
    description: "随手账本私人账目同步文件，请勿手动修改",
  };
  const body =
    "--" +
    boundary +
    "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    "\r\n--" +
    boundary +
    "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(pack) +
    "\r\n--" +
    boundary +
    "--";
  const data = await driveRequest(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,version",
    {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body,
    },
  );
  if (!data?.id) throw new Error("Google Drive 没有返回文件 ID");
  cloud.fileId = data.id;
  cloud.fileVersion = data.version || "";
}
async function fetchCloudFile() {
  const metadata = await driveRequest(
    DRIVE_API +
      "/files/" +
      encodeURIComponent(cloud.fileId) +
      "?fields=id,name,version,modifiedTime",
  );
  const data = await driveRequest(
    DRIVE_API + "/files/" + encodeURIComponent(cloud.fileId) + "?alt=media",
  );
  return { version: metadata.version || "", pack: checkedCloudPack(data) };
}
async function updateCloudFile(pack) {
  const data = await driveRequest(
    "https://www.googleapis.com/upload/drive/v3/files/" +
      encodeURIComponent(cloud.fileId) +
      "?uploadType=media&fields=id,version",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(pack),
    },
  );
  cloud.fileVersion = data?.version || cloud.fileVersion;
}
function scheduleCloudSync(delay = 900) {
  if (!cloud.ready) return;
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(() => {
    if (document.visibilityState === "visible") syncCloud().catch(() => {});
  }, delay);
}
async function syncCloud(first = false) {
  if (!cloud.ready) return;
  if (storageError) {
    cloudStateLabel(storageError, "warning");
    return;
  }
  if (cloud.busy) {
    cloud.queued = true;
    return;
  }
  if (document.visibilityState === "hidden") return;
  cloud.busy = true;
  first = first || !cloud.initialized;
  const startingSeq = cloudSeq;
  cloudStateLabel("☁ 正在同步 Google Drive…", "syncing");
  try {
    const id = await findCloudFile();
    if (startingSeq !== cloudSeq) {
      scheduleCloudSync(250);
      return;
    }
    const local = localCloudPack();
    if (!id) {
      if (
        first &&
        !confirm(
          "将此入口的 " +
            local.records.length +
            " 笔账目、" +
            local.cards.length +
            " 张储值卡和 " +
            local.memberships.length +
            " 项会员上传到 Google Drive，作为云端账本。确定继续吗？",
        )
      ) {
        cloud.ready = false;
        cloudStateLabel("尚未启用云端同步（本地数据未变）", "warning");
        return;
      }
      await createCloudFile(local);
      if (startingSeq !== cloudSeq) {
        scheduleCloudSync(250);
        return;
      }
      cloud.initialized = true;
      cloud.lastSync = Date.now();
      cloudStateLabel("☁ 已同步 · 云端已建立", "ok");
      return;
    }
    const remote = await fetchCloudFile();
    if (startingSeq !== cloudSeq) {
      scheduleCloudSync(250);
      return;
    }
    if (
      first &&
      (local.records.length ||
        local.cards.length ||
        local.memberships.length) &&
      (remote.pack.records.length ||
        remote.pack.cards.length ||
        remote.pack.memberships.length)
    ) {
      const msg =
        "首次连接：本地有 " +
        local.records.length +
        " 笔账目，云端有 " +
        remote.pack.records.length +
        " 笔账目。将按记录 ID 合并两边不同的账目、储值卡及会员。相同 ID 的内容会采用最近修改版本。建议先导出两边的重要备份。现在合并吗？";
      if (!confirm(msg)) {
        cloud.ready = false;
        cloudStateLabel("未执行首次合并（本地数据未变）", "warning");
        return;
      }
    }
    let merged = mergeCloudPacks(local, remote.pack);
    const changedRemote =
      packComparable(merged) !== packComparable(remote.pack);
    if (changedRemote) {
      // Recheck remote version immediately before upload. This reduces overwrites,
      // but Google Drive single-file updates are not an atomic multi-client DB.
      const latest = await fetchCloudFile();
      if (startingSeq !== cloudSeq) {
        scheduleCloudSync(250);
        return;
      }
      merged = mergeCloudPacks(local, latest.pack);
      if (packComparable(merged) !== packComparable(latest.pack))
        await updateCloudFile(merged);
    }
    if (startingSeq !== cloudSeq) {
      scheduleCloudSync(250);
      return;
    }
    if (!persistCloudMerge(merged)) return;
    cloud.initialized = true;
    cloud.lastSync = Date.now();
    cloudStateLabel(
      "☁ 已同步 · " +
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      "ok",
    );
  } catch (err) {
    cloudStateLabel(
      "☁ " + (err?.message || "同步失败，数据已保存在本机"),
      "warning",
    );
    console.warn("Google Drive 同步失败", err);
  } finally {
    cloud.busy = false;
    if (cloud.queued) {
      cloud.queued = false;
      scheduleCloudSync(500);
    }
  }
}
function getGoogleTokenFromClick() {
  if (!window.google?.accounts?.oauth2) {
    alert(
      "Google 授权服务尚未加载。请用 Safari 打开本站，检查网络，稍后再试。",
    );
    return;
  }
  if (cloud.authPrompt) return;
  cloud.authPrompt = true;
  try {
    cloud.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        cloud.authPrompt = false;
        if (!response?.access_token) {
          cloudStateLabel("Google 授权失败或取消，请重试", "warning");
          return;
        }
        cloudSeq++;
        cloud.token = response.access_token;
        cloud.expiresAt =
          Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000;
        cloud.fileId = "";
        cloud.ready = true;
        cloud.initialized = false;
        cloudStateLabel("☁ Google 已授权 · 正在读取云端账本", "syncing");
        syncCloud(true);
      },
      error_callback: () => {
        cloud.authPrompt = false;
        cloudStateLabel("Google 登录弹窗未完成，请用 Safari 重试", "warning");
      },
    });
    cloud.tokenClient.requestAccessToken({ prompt: "consent" });
  } catch (err) {
    cloud.authPrompt = false;
    cloudStateLabel("无法打开 Google 授权：" + err.message, "warning");
  }
}

function disconnectCloud() {
  clearTimeout(cloud.timer);
  cloudSeq++;
  const lastToken = cloud.token;
  cloud.ready = false;
  cloud.initialized = false;
  cloud.token = "";
  cloud.expiresAt = 0;
  cloud.fileId = "";
  if (lastToken) window.google?.accounts?.oauth2?.revoke(lastToken, () => {});
  cloudStateLabel("已停止同步 · 账目仍保存在本机及已写入的 Google Drive 文件");
}
setInterval(() => {
  if (cloud.ready && document.visibilityState === "visible") syncCloud();
}, 15000);
window.addEventListener("online", () => scheduleCloudSync(1200));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleCloudSync(500);
});
window.addEventListener("focus", () => scheduleCloudSync(600));

let storageTimer;
window.addEventListener("storage", (event) => {
  if (
    event.storageArea !== localStorage ||
    ![DB_KEY, EXTRAS_KEY, CLOUD_META_KEY, null].includes(event.key)
  )
    return;
  clearTimeout(storageTimer);
  storageTimer = setTimeout(() => {
    storageError = "";
    const data = loadLedger();
    cloudSeq++;
    if (!storageError) {
      Object.assign(state, data);
      cloudMeta = sanitizeMeta(readLocal(CLOUD_META_KEY, null));
      cloudBaseline = currentData();
      ensureCloudVersions(cloudBaseline, cloudMeta);
    }
    notify();
  }, 0);
});

export {
  CATEGORY,
  CURRENCIES,
  DRIVE_FILE_NAME,
  disconnectCloud,
  estimateCny,
  fxCache,
  fxLabel,
  getCategoryInfo,
  getCnyRate,
  getGoogleTokenFromClick,
  getSnapshot,
  localDatetime,
  localMonth,
  makeId,
  money,
  moneyDef,
  parseMoney,
  parseNonnegativeMoney,
  saveCurrency,
  state,
  subscribe,
  syncCloud,
  validateRecords,
  validateCards,
  validateMemberships,
  validDate,
  commit,
};
