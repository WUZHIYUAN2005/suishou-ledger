import {
  CATEGORY,
  commit,
  estimateCny,
  getCnyRate,
  localDatetime,
  localMonth,
  makeId,
  money,
  moneyDef,
  parseMoney,
  parseNonnegativeMoney,
  state,
  validateCards,
  validateMemberships,
  validateRecords,
  validDate,
} from "./ledger.js";

const MAX_MINOR = 1_000_000_000_000;
const isDatetime = (value) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
  !Number.isNaN(new Date(value).getTime());

export function amountInput(minor, currency) {
  const { digits } = moneyDef(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

// Editing a card purchase restores the old payment before validating the new one.
function refund(cards, record) {
  if (record?.type !== "expense" || !record.paymentCardId) return cards;
  return cards.map((card) =>
    card.id === record.paymentCardId && card.currency === record.currency
      ? { ...card, balanceMinor: card.balanceMinor + record.amountMinor }
      : card,
  );
}

export function saveEntry(id, data) {
  const { currency, occurredAt, type, category } = data;
  const amountMinor = parseMoney(data.amount, currency);
  if (amountMinor === null) {
    const { name, digits } = moneyDef(currency);
    throw new Error(`请输入有效的正数金额（${name}最多 ${digits} 位小数）。`);
  }
  if (!isDatetime(occurredAt)) throw new Error("请选择有效日期");
  const old = state.records.find((record) => record.id === id);
  if (id && !old) throw new Error("这笔账单已被移除，请刷新后重试。");
  const paymentCardId = type === "expense" ? data.paymentCardId : "";
  const keepOriginalFx =
    old?.fx &&
    type === "expense" &&
    currency === "CNY" &&
    amountMinor === old.amountMinor;
  const entry = {
    id: old?.id ?? makeId(),
    type,
    category,
    name: data.name.trim().slice(0, 80) || category,
    amountMinor,
    currency,
    occurredAt,
    createdAt: old?.createdAt ?? new Date().toISOString(),
    ...(paymentCardId ? { paymentCardId } : {}),
    ...(old?.membershipId && type === "expense"
      ? { membershipId: old.membershipId }
      : {}),
    ...(keepOriginalFx ? { fx: old.fx } : {}),
  };
  let cards = refund(state.cards, old);
  if (paymentCardId) {
    const card = cards.find(
      (item) => item.id === paymentCardId && item.currency === currency,
    );
    if (!card) throw new Error("所选储值卡与金额币种不一致，请重新选择");
    if (card.balanceMinor < amountMinor) {
      throw new Error(
        `储值卡余额不足。当前可用：${money(card.balanceMinor, card.currency)}`,
      );
    }
    cards = cards.map((item) =>
      item.id === card.id
        ? { ...item, balanceMinor: item.balanceMinor - amountMinor }
        : item,
    );
  }
  if (cards.some((card) => card.balanceMinor > MAX_MINOR))
    throw new Error("退回金额后将超出储值卡余额上限。");
  const records = old
    ? state.records.map((record) => (record.id === id ? entry : record))
    : [entry, ...state.records];
  commit({ records, cards });
}

export function deleteEntry(id) {
  const record = state.records.find((item) => item.id === id);
  if (
    !record ||
    !confirm("确定删除这笔记录吗？如使用储值卡付款，将把该金额加回卡内余额。")
  )
    return false;
  const cards = refund(state.cards, record);
  if (cards.some((card) => card.balanceMinor > MAX_MINOR))
    throw new Error("退回金额后将超出储值卡余额上限。");
  commit({ records: state.records.filter((item) => item.id !== id), cards });
  return true;
}

export function saveCard(id, data) {
  const old = state.cards.find((card) => card.id === id);
  if (id && !old) throw new Error("此卡已被移除，请关闭窗口后重试。");
  const currency = old?.currency ?? data.currency;
  const balanceMinor = parseNonnegativeMoney(data.balance, currency);
  const name = data.name.trim().slice(0, 40);
  if (!name || balanceMinor === null)
    throw new Error("请输入有效的名称和非负余额");
  if (!old && state.cards.length >= 100)
    throw new Error("最多可保存 100 张储值卡。");
  const card = { id: old?.id ?? makeId(), name, currency, balanceMinor };
  commit({
    cards: old
      ? state.cards.map((item) => (item.id === id ? card : item))
      : [...state.cards, card],
  });
  return card.id;
}

export function deleteCard(id) {
  const card = state.cards.find((item) => item.id === id);
  if (
    !card ||
    !confirm(
      `确定移除「${card.name}」吗？关联的历史账单会保留，但不再关联此卡。`,
    )
  )
    return false;
  const records = state.records.map((record) => {
    if (record.paymentCardId !== id) return record;
    const { paymentCardId, ...rest } = record;
    return rest;
  });
  commit({ cards: state.cards.filter((item) => item.id !== id), records });
  return true;
}

export function topupCard(id, value) {
  const card = state.cards.find((item) => item.id === id);
  if (!card) throw new Error("此卡已被移除，请关闭窗口后重试。");
  const amount = parseMoney(value, card.currency);
  if (amount === null || card.balanceMinor + amount > MAX_MINOR)
    throw new Error("请输入有效的充值金额");
  const cards = state.cards.map((item) =>
    item.id === id
      ? { ...item, balanceMinor: item.balanceMinor + amount }
      : item,
  );
  commit({ cards });
}

export const CYCLE_NAMES = {
  month: "每月",
  quarter: "每季度",
  year: "每年",
  once: "一次性",
};

async function makeMemberPayment(member, data) {
  const { currency, amountMinor } = member;
  const { when, category } = data;
  if (!isDatetime(when)) throw new Error("请输入有效的实际付款时间");
  if (!CATEGORY.expense.some((item) => item.name === category))
    throw new Error("请选择有效的支出分类");
  const override = data.actualCny.trim();
  const actual = override ? parseMoney(override, "CNY") : null;
  if (override && actual === null)
    throw new Error("银行实际扣款人民币金额无效");

  let snapshot;
  let amountCny;
  if (currency === "CNY") {
    amountCny = actual ?? amountMinor;
  } else if (actual !== null) {
    amountCny = actual;
    snapshot = {
      rate: actual / 100 / (amountMinor / 10 ** moneyDef(currency).digits),
      date: when.slice(0, 10),
      fetchedAt: new Date().toISOString(),
      source: "实际扣款",
    };
  } else {
    try {
      snapshot = await getCnyRate(currency, true);
    } catch (_) {
      throw new Error(
        "暂时无法获取最新参考汇率。请联网后重试，或填写银行卡实际扣款的人民币金额。",
      );
    }
    amountCny = estimateCny(amountMinor, currency, snapshot.rate);
  }
  if (
    !Number.isSafeInteger(amountCny) ||
    amountCny <= 0 ||
    amountCny > MAX_MINOR ||
    (snapshot && (snapshot.rate <= 0 || snapshot.rate > 100_000))
  ) {
    throw new Error("人民币金额或换算汇率无效");
  }
  if (
    snapshot?.source === "Frankfurter" &&
    when.slice(0, 10) !== localDatetime().slice(0, 10) &&
    !confirm(
      `您选择的付款日期是 ${when.slice(0, 10)}，参考汇率日期为 ${snapshot.date}。仍按当前参考汇率记账吗？`,
    )
  )
    return null;
  if (
    state.records.some(
      (record) =>
        record.membershipId === member.id &&
        Math.abs(new Date(record.occurredAt) - new Date(when)) < 7 * 86400000,
    ) &&
    !confirm("近 7 天已为此会员记过付款记录。确定再次记入一笔吗？")
  )
    return null;
  return {
    id: makeId(),
    type: "expense",
    category,
    name: `${member.name} · 会员订阅`.slice(0, 80),
    currency: "CNY",
    amountMinor: amountCny,
    occurredAt: when,
    createdAt: new Date().toISOString(),
    membershipId: member.id,
    ...(snapshot
      ? {
          fx: {
            originalCurrency: currency,
            originalAmountMinor: amountMinor,
            rate: snapshot.rate,
            rateDate: snapshot.date,
            source: snapshot.source,
            capturedAt: snapshot.fetchedAt,
          },
        }
      : {}),
  };
}

export async function saveMember(id, data) {
  const { currency, nextDate, cycle, active, autoRenew } = data;
  const name = data.name.trim().slice(0, 50);
  const amountMinor = parseMoney(data.amount, currency);
  if (!name || amountMinor === null || !validDate(nextDate))
    throw new Error("请输入会员名称、有效费用和日期");
  const member = {
    id: id ?? makeId(),
    name,
    currency,
    amountMinor,
    cycle,
    nextDate,
    active,
    autoRenew,
    note: data.note.trim().slice(0, 100),
  };
  const entry = data.paid ? await makeMemberPayment(member, data) : null;
  if (data.paid && !entry) return false;
  if (id && !state.memberships.some((item) => item.id === id))
    throw new Error("此会员已被移除，请关闭窗口后重试。");
  if (!id && state.memberships.length >= 500)
    throw new Error("最多可保存 500 项会员及订阅。");
  const memberships = id
    ? state.memberships.map((item) => (item.id === id ? member : item))
    : [...state.memberships, member];
  commit({
    memberships,
    ...(entry ? { records: [entry, ...state.records] } : {}),
  });
  return true;
}

export function deleteMember(id) {
  if (!confirm("确定删除这项会员记录吗？历史账目不会变化。")) return false;
  commit({ memberships: state.memberships.filter((item) => item.id !== id) });
  return true;
}

export function downloadBackup() {
  const { records, cards, memberships } = state;
  const data = {
    app: "随手账本",
    version: 2,
    exportedAt: new Date().toISOString(),
    records,
    cards,
    memberships,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `随手账本备份-${localMonth()}-${localDatetime().slice(8, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function importBackup(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error("备份文件过大");
  const json = JSON.parse(await file.text());
  if (json?.app !== "随手账本" || ![1, 2].includes(json.version))
    throw new Error("不是本应用支持的备份格式");
  const records = validateRecords(json.records);
  const full = json.version === 2;
  const extras = full
    ? {
        cards: validateCards(json.cards),
        memberships: validateMemberships(json.memberships),
      }
    : {};
  const warning = full
    ? `同时替换当前 ${state.cards.length} 张储值卡、${state.memberships.length} 项会员记录。`
    : "旧版备份只替换账单，储值卡与会员资料保留。";
  if (
    !confirm(
      `将用备份里的 ${records.length} 笔记录覆盖当前 ${state.records.length} 笔记录。${warning} 确定继续吗？`,
    )
  )
    return null;
  commit({ records, ...extras }, full);
  return records.length;
}

export function clearRecords() {
  if (
    !confirm(
      `这会删除此网页里全部 ${state.records.length} 笔账目。确定继续吗？`,
    ) ||
    !confirm("最后确认：清空后只能通过先前导出的备份恢复。")
  )
    return false;
  commit({ records: [] });
  return true;
}
