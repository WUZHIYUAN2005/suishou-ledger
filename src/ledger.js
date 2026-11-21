import { createDriveClient, DRIVE_ROOT } from "./drive.js";

const DB_KEY = "suishou-ledger.records.v1";
const PREF_KEY = "suishou-ledger.prefs.v1";
const EXTRAS_KEY = "suishou-ledger.extras.v1";
const CLOUD_META_KEY = "suishou-ledger.cloud-meta.v1";
const CLOUD_FREQUENCY_KEY = "suishou-ledger.cloud-frequency.v1";
const CLOUD_TIME_PREFIX = "suishou-ledger.cloud-last-sync.v1.";
const DRIVE_CLIENT_ID =
  "623321438376-t93joh0ms0fb806lp043k9mrub8o3f6c.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FILE_NAME = "随手账本-云端同步.json";
const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const BACKUP_FREQUENCIES = {
  changes: { label: "修改后自动同步", interval: 15_000 },
  "15m": { label: "每 15 分钟", interval: 15 * 60_000 },
  "1h": { label: "每小时", interval: 60 * 60_000 },
  "1d": { label: "每天", interval: 24 * 60 * 60_000 },
  manual: { label: "仅手动", interval: null },
};
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
const readBackupFrequency = () => {
  const frequency = readLocal(CLOUD_FREQUENCY_KEY, "changes");
  return Object.hasOwn(BACKUP_FREQUENCIES, frequency) ? frequency : "changes";
};
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
  cloudChecked: false,
  cloudBusy: false,
  cloudSession: 0,
  cloudFileId: "",
  cloudFolderName: "",
  cloudLastSync: 0,
  cloudFrequency: readBackupFrequency(),
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
  scheduleCloudSync(750);
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
let cloudSerial = 0;
let authPrompt = false;
let authorizationAttempt = 0;
function makeCloudSession(drive = null, token = "") {
  return {
    serial: ++cloudSerial,
    drive,
    token,
    backup: null,
    destination: DRIVE_ROOT,
    folderName: "",
    checked: false,
    busy: false,
    initialized: false,
    paused: false,
    timer: null,
    lastSync: 0,
    retryAfter: 0,
  };
}
let cloud = makeCloudSession();
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

function publishCloud() {
  state.cloudReady = !!cloud.drive;
  state.cloudChecked = cloud.checked;
  state.cloudBusy = cloud.busy;
  state.cloudSession = cloud.serial;
  state.cloudFileId = cloud.backup?.id ?? "";
  state.cloudFolderName = cloud.backup
    ? cloud.folderName
    : cloud.destination.name;
  state.cloudLastSync = cloud.lastSync;
  notify();
}
function cloudStateLabel(message, kind = "idle") {
  state.cloudMessage = message;
  state.cloudStatus = kind;
  publishCloud();
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
function setBackupFrequency(frequency) {
  if (!Object.hasOwn(BACKUP_FREQUENCIES, frequency)) return;
  localStorage.setItem(CLOUD_FREQUENCY_KEY, JSON.stringify(frequency));
  state.cloudFrequency = frequency;
  cloud.retryAfter = 0;
  scheduleCloudSync();
  notify();
}

function getLastBackupTime(id) {
  const saved = readLocal(CLOUD_TIME_PREFIX + id, 0);
  return Number.isFinite(saved) && saved > 0 ? Math.min(saved, Date.now()) : 0;
}

function recordBackupTime(session) {
  session.initialized = true;
  session.paused = false;
  session.lastSync = Date.now();
  try {
    localStorage.setItem(
      CLOUD_TIME_PREFIX + session.backup.id,
      String(session.lastSync),
    );
  } catch (_) {
    // The completed backup remains valid even if remembering its date fails.
  }
}

function requireDrive() {
  if (!cloud.drive || !cloud.checked) throw new Error("请先连接 Google Drive");
  return cloud;
}

function assertActive(session) {
  if (session !== cloud) throw new Error("Google Drive 连接已变更");
}

function rememberBackup(session, file) {
  if (session.backup?.parents?.[0] !== file?.parents?.[0])
    session.folderName = "";
  session.backup = file;
}

async function refreshFolderName(session) {
  const parent = session.backup?.parents?.[0];
  if (!parent || session.folderName) return;
  const [root, folder] = await Promise.all([
    session.drive.folder(DRIVE_ROOT.id).catch(() => null),
    session.drive.folder(parent).catch(() => null),
  ]);
  if (session !== cloud || session.backup?.parents?.[0] !== parent) return;
  session.folderName =
    root?.id === parent ? DRIVE_ROOT.name : (folder?.name ?? "");
  publishCloud();
}

async function listBackupFolders() {
  const session = requireDrive();
  const folders = await session.drive.listFolders();
  assertActive(session);
  return [DRIVE_ROOT, ...folders];
}

async function createBackupFolder(name) {
  const session = requireDrive();
  const folder = await session.drive.createFolder(name);
  assertActive(session);
  return folder;
}

async function setBackupFolder(id) {
  const session = requireDrive();
  if (session.busy) throw new Error("请等当前同步完成后再更改位置");
  clearTimeout(session.timer);
  session.busy = true;
  publishCloud();
  try {
    const target =
      !session.backup && id === DRIVE_ROOT.id
        ? DRIVE_ROOT
        : await session.drive.destination(id);
    assertActive(session);
    if (session.backup) {
      const moved = await session.drive.moveBackup(session.backup.id, target);
      assertActive(session);
      rememberBackup(session, moved);
      session.folderName = target.name;
    } else {
      session.destination = target;
    }
  } finally {
    if (session === cloud) {
      session.busy = false;
      publishCloud();
      scheduleCloudSync();
    }
  }
}

function scheduleCloudSync(changeDelay) {
  const session = cloud;
  clearTimeout(session.timer);
  const frequency = state.cloudFrequency;
  const interval = BACKUP_FREQUENCIES[frequency].interval;
  if (
    interval === null ||
    !session.drive ||
    !session.checked ||
    !session.backup ||
    session.paused ||
    session.busy ||
    !navigator.onLine ||
    document.visibilityState === "hidden"
  )
    return;

  const now = Date.now();
  if (now >= session.drive.expiresAt) {
    cloudStateLabel("Google 授权已过期，重新授权后可继续备份", "warning");
    return;
  }
  const next =
    frequency === "changes" && changeDelay !== undefined
      ? now + changeDelay
      : session.lastSync + interval;
  const wake = Math.min(
    Math.max(now, next, session.retryAfter),
    session.drive.expiresAt,
  );
  session.timer = setTimeout(() => {
    if (session !== cloud) return;
    if (Date.now() >= session.drive.expiresAt) {
      cloudStateLabel("Google 授权已过期，重新授权后可继续备份", "warning");
      return;
    }
    void syncCloud(false);
  }, wake - now);
}

async function inspectCloud(session) {
  session.busy = true;
  cloudStateLabel("Google 已授权 · 正在检查云端账本", "syncing");
  try {
    const backup = await session.drive.findBackup();
    assertActive(session);
    rememberBackup(session, backup);
    session.lastSync = backup ? getLastBackupTime(backup.id) : 0;
    session.initialized = !!session.lastSync;
    session.checked = true;
    cloudStateLabel(
      backup ? "Google Drive 已连接" : "已授权 · 选择位置后可进行首次备份",
    );
    if (backup) void refreshFolderName(session);
  } catch (error) {
    if (session === cloud) cloudStateLabel(error.message, "warning");
  } finally {
    if (session === cloud) {
      session.busy = false;
      publishCloud();
      scheduleCloudSync(0);
    }
  }
}

async function syncCloud(manual = true) {
  const session = cloud;
  if (!session.drive || session.busy || document.visibilityState === "hidden")
    return;
  if (
    !manual &&
    (!session.backup || session.paused || state.cloudFrequency === "manual")
  )
    return;
  if (!session.checked) {
    await inspectCloud(session);
    return;
  }
  if (storageError) {
    cloudStateLabel(storageError, "warning");
    return;
  }

  clearTimeout(session.timer);
  session.busy = true;
  let recheck = false;
  const startingSeq = cloudSeq;
  function changedWhileSyncing() {
    assertActive(session);
    recheck = startingSeq !== cloudSeq;
    return recheck;
  }
  cloudStateLabel("正在同步 Google Drive…", "syncing");
  try {
    // Look up the file again before initially creating it, including after an interrupted upload.
    if (!session.backup)
      rememberBackup(session, await session.drive.findBackup());
    if (changedWhileSyncing()) return;
    const local = localCloudPack();
    if (!session.backup) {
      const target =
        session.destination.id === DRIVE_ROOT.id
          ? DRIVE_ROOT
          : await session.drive.destination(session.destination.id);
      if (changedWhileSyncing()) return;
      if (
        !confirm(
          `将 ${local.records.length} 笔账单、${local.cards.length} 张储值卡和 ${local.memberships.length} 项订阅备份到「${target.name}」。确定继续吗？`,
        )
      ) {
        session.paused = true;
        cloudStateLabel("未进行首次备份，可随时手动开始");
        return;
      }
      rememberBackup(
        session,
        await session.drive.createBackup(local, target.id),
      );
      assertActive(session);
      session.folderName = target.name;
      recordBackupTime(session);
      if (changedWhileSyncing()) return;
    } else {
      const id = session.backup.id;
      const previousParent = session.backup.parents?.[0];
      const metadata = await session.drive.getBackup(id);
      if (changedWhileSyncing()) return;
      if (metadata.trashed) throw new Error("云端账本在回收站，请恢复后重试");
      // Older authorized files may omit parent metadata, for example after a move in Drive.
      rememberBackup(session, { ...session.backup, ...metadata });
      if (previousParent !== session.backup.parents?.[0])
        void refreshFolderName(session);
      const remote = checkedCloudPack(await session.drive.readBackup(id));
      if (changedWhileSyncing()) return;
      if (
        !session.initialized &&
        (local.records.length ||
          local.cards.length ||
          local.memberships.length) &&
        (remote.records.length ||
          remote.cards.length ||
          remote.memberships.length) &&
        !confirm(
          `本地有 ${local.records.length} 笔账单，云端有 ${remote.records.length} 笔账单。首次同步会按记录 ID 合并账单、储值卡和订阅。现在合并吗？`,
        )
      ) {
        session.paused = true;
        cloudStateLabel("未执行首次合并，可随时手动开始");
        return;
      }
      let merged = mergeCloudPacks(local, remote);
      if (packComparable(merged) !== packComparable(remote)) {
        // Refresh the remote copy immediately before writing.
        const latest = checkedCloudPack(await session.drive.readBackup(id));
        if (changedWhileSyncing()) return;
        merged = mergeCloudPacks(local, latest);
        if (packComparable(merged) !== packComparable(latest)) {
          await session.drive.writeBackup(id, merged);
        }
      }
      if (changedWhileSyncing()) return;
      if (
        packComparable(merged) !== packComparable(local) &&
        !persistCloudMerge(merged)
      ) {
        session.retryAfter = Date.now() + 30_000;
        return;
      }
      recordBackupTime(session);
    }
    session.retryAfter = 0;
    cloudStateLabel(
      "已同步 · " +
        new Date(session.lastSync).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      "ok",
    );
  } catch (error) {
    if (session === cloud) {
      session.retryAfter = Date.now() + 30_000;
      cloudStateLabel(
        error?.message || "同步失败，数据仍保存在本机",
        "warning",
      );
      console.warn("Google Drive 同步失败", error);
    }
  } finally {
    if (session === cloud) {
      session.busy = false;
      if (recheck) {
        cloudStateLabel("同步期间账目有更新，将按当前设置重试");
        if (manual) {
          session.timer = setTimeout(() => {
            if (session === cloud) void syncCloud();
          }, 250);
        } else {
          scheduleCloudSync(250);
        }
      } else {
        publishCloud();
        scheduleCloudSync();
      }
    }
  }
}

let googleAuthorizationRequest;
function loadGoogleAuthorization() {
  if (window.google?.accounts?.oauth2?.initTokenClient)
    return Promise.resolve();
  googleAuthorizationRequest ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("暂时无法连接 Google 授权服务。"));
    };
    const timeout = setTimeout(fail, 10000);
    script.onerror = fail;
    script.onload = () => {
      if (!window.google?.accounts?.oauth2?.initTokenClient) {
        fail();
        return;
      }
      clearTimeout(timeout);
      resolve();
    };
    document.head.append(script);
  }).catch((error) => {
    googleAuthorizationRequest = undefined;
    throw error;
  });
  return googleAuthorizationRequest;
}

function getGoogleTokenFromClick() {
  if (!window.google?.accounts?.oauth2?.initTokenClient) return false;
  if (authPrompt || cloud.busy) return true;
  authPrompt = true;
  const attempt = ++authorizationAttempt;
  try {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (attempt !== authorizationAttempt) return;
        authPrompt = false;
        if (!response?.access_token) {
          cloudStateLabel("Google 授权失败或取消，请重试", "warning");
          return;
        }
        clearTimeout(cloud.timer);
        cloud.drive?.close();
        const token = response.access_token;
        const expiresAt =
          Date.now() +
          Math.max(10, Number(response.expires_in) || 3600) * 1000 -
          5000;
        cloud = makeCloudSession(
          createDriveClient(token, expiresAt, DRIVE_FILE_NAME),
          token,
        );
        void inspectCloud(cloud);
      },
      error_callback: () => {
        if (attempt !== authorizationAttempt) return;
        authPrompt = false;
        cloudStateLabel("Google 登录弹窗未完成，请用 Safari 重试", "warning");
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  } catch (err) {
    authPrompt = false;
    cloudStateLabel("无法打开 Google 授权：" + err.message, "warning");
  }
  return true;
}

function disconnectCloud() {
  authorizationAttempt++;
  authPrompt = false;
  clearTimeout(cloud.timer);
  const lastToken = cloud.token;
  cloud.drive?.close();
  cloud = makeCloudSession();
  if (lastToken) window.google?.accounts?.oauth2?.revoke(lastToken, () => {});
  cloudStateLabel("已停止同步 · 账目仍保存在本机及已写入的 Google Drive 文件");
}
window.addEventListener("online", () => scheduleCloudSync(1200));
document.addEventListener("visibilitychange", () => {
  scheduleCloudSync(500);
});
window.addEventListener("focus", () => scheduleCloudSync(600));

let storageTimer;
window.addEventListener("storage", (event) => {
  if (event.storageArea !== localStorage) return;
  if (event.key === CLOUD_FREQUENCY_KEY || event.key === null) {
    state.cloudFrequency = readBackupFrequency();
    scheduleCloudSync();
    notify();
  }
  if (cloud.backup && event.key === CLOUD_TIME_PREFIX + cloud.backup.id) {
    cloud.lastSync = Math.max(
      cloud.lastSync,
      getLastBackupTime(cloud.backup.id),
    );
    publishCloud();
    scheduleCloudSync();
  }
  if (![DB_KEY, EXTRAS_KEY, CLOUD_META_KEY, null].includes(event.key)) return;
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
    scheduleCloudSync(750);
  }, 0);
});

export {
  BACKUP_FREQUENCIES,
  CATEGORY,
  CURRENCIES,
  createBackupFolder,
  DRIVE_FILE_NAME,
  disconnectCloud,
  estimateCny,
  fxCache,
  fxLabel,
  getCategoryInfo,
  getCnyRate,
  getGoogleTokenFromClick,
  getSnapshot,
  listBackupFolders,
  loadGoogleAuthorization,
  localDatetime,
  localMonth,
  makeId,
  money,
  moneyDef,
  parseMoney,
  parseNonnegativeMoney,
  saveCurrency,
  setBackupFolder,
  setBackupFrequency,
  state,
  subscribe,
  syncCloud,
  validateRecords,
  validateCards,
  validateMemberships,
  validDate,
  commit,
};
