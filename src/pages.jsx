import { Fragment, useEffect, useState } from "react";
import {
  CATEGORY,
  estimateCny,
  fxCache,
  fxLabel,
  getCategoryInfo,
  getCnyRate,
  localDatetime,
  money,
  moneyDef,
} from "./ledger.js";
import { CYCLE_NAMES } from "./actions.js";
import {
  CurrencySelect,
  GlassButton,
  Icon,
  Panel,
  PanelHeading,
  Select,
  useObjectUrl,
} from "./ui.jsx";

const NEWEST = (a, b) =>
  b.occurredAt.localeCompare(a.occurredAt) ||
  b.createdAt.localeCompare(a.createdAt);
const matchQuery = (entry, query) =>
  `${entry.name} ${entry.category}`
    .toLocaleLowerCase("zh-CN")
    .includes(query.trim().toLocaleLowerCase("zh-CN"));

export const inRange = (records, range) =>
  records.filter(
    (entry) => range.all || entry.occurredAt.slice(0, 7) === range.month,
  );

const monthInput = document.createElement("input");
monthInput.type = "month";
const supportsMonthInput = monthInput.type === "month";

export function MonthFilter({
  range,
  onChange,
  stacked = false,
  browseFromAll = false,
}) {
  const [year, month] = range.month.split("-").map(Number);
  const formatted = stacked
    ? `${month}月`
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
      }).format(new Date(year, month - 1, 1));
  const move = (step) => {
    const index = year * 12 + month - 1 + step;
    if (index < 1000 * 12 || index >= 10_000 * 12) return;
    const value = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    onChange({ month: value, all: false });
  };
  const change = (event) => {
    if (/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(event.target.value)) {
      onChange({ month: event.target.value, all: false });
    }
  };
  const disabled = range.all && !browseFromAll;
  const previous = (
    <GlassButton
      className="month-arrow"
      onClick={() => move(-1)}
      disabled={disabled}
      aria-label="上个月"
    >
      <Icon name={stacked ? "up" : "left"} size={16} />
    </GlassButton>
  );
  const next = (
    <GlassButton
      className="month-arrow"
      onClick={() => move(1)}
      disabled={disabled}
      aria-label="下个月"
    >
      <Icon name={stacked ? "down" : "right"} size={16} />
    </GlassButton>
  );
  return (
    <div className={`range-actions ${stacked ? "stacked-range" : ""}`}>
      <div className="month-shell">
        {!stacked && previous}
        {supportsMonthInput ? (
          <label className="month-label" title={`${year} 年 ${month} 月`}>
            <span key={range.month} className="month-value">
              {formatted}
            </span>
            <input
              type="month"
              aria-label="选择月份"
              value={range.month}
              disabled={disabled}
              onChange={change}
              onClick={(event) => {
                try {
                  event.currentTarget.showPicker?.();
                } catch (_) {
                  /* Native picker fallback. */
                }
              }}
            />
          </label>
        ) : (
          <input
            key={range.month}
            className="month-fallback"
            aria-label="选择月份（YYYY-MM）"
            defaultValue={range.month}
            maxLength={7}
            disabled={disabled}
            onBlur={change}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        )}
        {stacked ? (
          <div className="month-steppers">
            {previous}
            {next}
          </div>
        ) : (
          next
        )}
      </div>
      <GlassButton
        className={`time-switch ${range.all ? "selected" : ""}`}
        aria-pressed={range.all}
        onClick={() => onChange({ ...range, all: !range.all })}
      >
        全部时间
      </GlassButton>
    </div>
  );
}

function Figure({ label, total, currency, tone }) {
  return (
    <Panel className={`figure ${tone}`} aria-label={label}>
      <div className="figure-label">
        <span className="figure-icon">
          <Icon name={tone} size={19} />
        </span>
        {label}
      </div>
      <strong>{money(total, currency)}</strong>
    </Panel>
  );
}

function EntryRow({ entry, recent, grouped, open }) {
  const category = getCategoryInfo(entry.type, entry.category);
  const when = recent
    ? entry.occurredAt.slice(5).replace("T", " ")
    : grouped
      ? entry.occurredAt.slice(11)
      : entry.occurredAt.replace("T", " ");
  const detail = recent
    ? `${when} · ${entry.category}`
    : `${entry.category} · ${entry.currency} · ${when}`;
  return (
    <GlassButton
      className="entry-row"
      onClick={() => open(entry.id)}
      aria-label={`编辑${entry.name || entry.category}`}
    >
      <span className="category-icon" style={{ "--category": category.color }}>
        {category.icon}
      </span>
      <span className="entry-body">
        <strong>{entry.name || entry.category}</strong>
        <small>
          {detail}
          {!recent &&
            entry.fx &&
            ` · 原价 ${money(entry.fx.originalAmountMinor, entry.fx.originalCurrency)} · 汇率 ${entry.fx.source} ${entry.fx.rateDate}`}
        </small>
      </span>
      <span className={`entry-amount ${entry.type}`}>
        {entry.type === "income" ? "+" : "−"}
        {money(entry.amountMinor, entry.currency)}
      </span>
    </GlassButton>
  );
}

function Empty({ icon = "receipt", title, children }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={25} />
      </span>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Overview({
  records,
  currency,
  range,
  changeRange,
  search,
  openEntry,
  showBills,
}) {
  const totals = { income: 0, expense: 0 };
  for (const entry of records) {
    if (entry.currency === currency) totals[entry.type] += entry.amountMinor;
  }
  const recent = records
    .filter((entry) => matchQuery(entry, search))
    .sort(NEWEST)
    .slice(0, 4);
  return (
    <>
      <div className="page-heading overview-heading">
        <h1>收支概览</h1>
        <MonthFilter range={range} onChange={changeRange} stacked />
        <div className="balance-line">
          <span>账户结余 · {currency}</span>
          <strong>{money(totals.income - totals.expense, currency)}</strong>
        </div>
      </div>
      <div className="figure-grid">
        <Figure
          label="收入"
          currency={currency}
          total={totals.income}
          tone="income"
        />
        <Figure
          label="支出"
          currency={currency}
          total={totals.expense}
          tone="expense"
        />
      </div>
      <Panel className="recent-panel" aria-label="最近账单">
        <PanelHeading title="最近账单">
          <GlassButton className="small" onClick={showBills}>
            查看全部 <Icon name="right" size={14} />
          </GlassButton>
        </PanelHeading>
        <div className="entry-list" aria-live="polite">
          {recent.length ? (
            recent.map((entry) => (
              <EntryRow key={entry.id} entry={entry} recent open={openEntry} />
            ))
          ) : (
            <Empty
              title={
                search.trim() ? "没有符合条件的近期账单" : "这段时间还没有账单"
              }
            >
              <p>
                {search.trim()
                  ? "可尝试其他名称或分类。"
                  : "点击下方的 ＋，记下第一笔收入或支出。"}
              </p>
            </Empty>
          )}
        </div>
      </Panel>
    </>
  );
}

const allCategories = [
  ...new Set(
    [...CATEGORY.expense, ...CATEGORY.income].map((category) => category.name),
  ),
];
const nominal = (entry) =>
  entry.amountMinor / 10 ** moneyDef(entry.currency).digits;
const compare = {
  newest: NEWEST,
  oldest: (a, b) => a.occurredAt.localeCompare(b.occurredAt),
  amountDesc: (a, b) => nominal(b) - nominal(a),
  amountAsc: (a, b) => nominal(a) - nominal(b),
};

export function Bills({
  records,
  hasAny,
  range,
  changeRange,
  filters,
  changeFilters,
  search,
  changeSearch,
  openEntry,
}) {
  const { type, category, currency, sort } = filters;
  const categories =
    type === "all" ? allCategories : CATEGORY[type].map((item) => item.name);
  const list = records
    .filter(
      (entry) =>
        (type === "all" || entry.type === type) &&
        (category === "all" || entry.category === category) &&
        (currency === "all" || entry.currency === currency) &&
        matchQuery(entry, search),
    )
    .sort(compare[sort]);
  const grouped = sort === "newest" || sort === "oldest";
  const formatDay = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    year: "numeric",
    weekday: "short",
  });
  const changeType = (value) => {
    const keep =
      value === "all" || CATEGORY[value].some((item) => item.name === category);
    changeFilters({
      ...filters,
      type: value,
      category: keep ? category : "all",
    });
  };
  return (
    <>
      <div className="page-heading">
        <h1>账单明细</h1>
        <MonthFilter range={range} onChange={changeRange} />
      </div>
      <Panel aria-label="账单明细">
        <PanelHeading title="账单明细">
          <span className="muted">共 {list.length} 笔</span>
        </PanelHeading>
        <div className="bill-filters">
          <Select
            aria-label="筛选收支类型"
            value={type}
            onChange={(event) => changeType(event.target.value)}
          >
            <option value="all">全部收支</option>
            <option value="expense">仅看支出</option>
            <option value="income">仅看收入</option>
          </Select>
          <Select
            aria-label="筛选分类"
            value={category}
            onChange={(event) =>
              changeFilters({ ...filters, category: event.target.value })
            }
          >
            <option value="all">全部分类</option>
            {categories.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
          <Select
            aria-label="排序方式"
            value={sort}
            onChange={(event) =>
              changeFilters({ ...filters, sort: event.target.value })
            }
          >
            <option value="newest">时间：最近优先</option>
            <option value="amountDesc">金额：从大到小</option>
            <option value="amountAsc">金额：从小到大</option>
            <option value="oldest">时间：最早优先</option>
          </Select>
        </div>
        <div className="bill-filters secondary">
          <input
            className="glass-input"
            aria-label="搜索名称或分类"
            placeholder="搜索名称或分类"
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
          />
          <CurrencySelect
            withAll
            aria-label="筛选账单币种"
            value={currency}
            onChange={(event) =>
              changeFilters({ ...filters, currency: event.target.value })
            }
          />
        </div>
        <div className="entry-list" aria-live="polite">
          {list.length ? (
            list.map((entry, index) => {
              const day = entry.occurredAt.slice(0, 10);
              return (
                <Fragment key={entry.id}>
                  {grouped &&
                    day !== list[index - 1]?.occurredAt.slice(0, 10) && (
                      <div className="date-heading">
                        {formatDay.format(new Date(`${day}T12:00`))}
                      </div>
                    )}
                  <EntryRow entry={entry} grouped={grouped} open={openEntry} />
                </Fragment>
              );
            })
          ) : (
            <Empty title={hasAny ? "没有符合条件的账单" : "这里还没有账单"}>
              <p>
                {hasAny
                  ? "试试切换月份、分类或币种。"
                  : "从记录第一笔收入或支出开始。"}
              </p>
              <GlassButton className="small" onClick={() => openEntry()}>
                ＋ 新增一笔
              </GlassButton>
            </Empty>
          )}
        </div>
      </Panel>
    </>
  );
}

export function Stats({
  records,
  currency,
  changeCurrency,
  type,
  changeType,
  range,
  changeRange,
}) {
  const totals = new Map();
  let total = 0;
  for (const item of records) {
    if (item.currency !== currency || item.type !== type) continue;
    total += item.amountMinor;
    totals.set(
      item.category,
      (totals.get(item.category) ?? 0) + item.amountMinor,
    );
  }
  let start = 0;
  const groups = [...totals]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => {
      const color = getCategoryInfo(type, name).color;
      const end = start + (value / total) * 100;
      const slice = `${color} ${start}% ${end}%`;
      start = end;
      return {
        name,
        color,
        value,
        slice,
        share: ((value / total) * 100).toFixed(1),
      };
    });
  const ring = total
    ? `conic-gradient(${groups.map(({ slice }) => slice).join(",")})`
    : undefined;
  return (
    <>
      <div className="page-heading">
        <h1>分类统计</h1>
        <MonthFilter range={range} onChange={changeRange} />
      </div>
      <Panel aria-label="分类统计">
        <PanelHeading title="分类统计">
          <span className="muted">按占比分析</span>
        </PanelHeading>
        <div className="stat-tabs" role="group" aria-label="统计收支类型">
          <GlassButton
            className={type === "expense" ? "selected" : ""}
            aria-pressed={type === "expense"}
            onClick={() => changeType("expense")}
          >
            支出分析
          </GlassButton>
          <GlassButton
            className={type === "income" ? "selected" : ""}
            aria-pressed={type === "income"}
            onClick={() => changeType("income")}
          >
            收入分析
          </GlassButton>
        </div>
        <div className="stat-currency">
          <span className="muted">选择统计币种</span>
          <CurrencySelect
            aria-label="统计币种"
            value={currency}
            onChange={(event) => changeCurrency(event.target.value)}
          />
        </div>
        <div className="donut-wrap">
          <div
            className="donut"
            role="img"
            style={{ background: ring }}
            aria-label={
              total
                ? groups.map(({ name, share }) => `${name}${share}%`).join("，")
                : "当前没有分类数据"
            }
          >
            <div className="donut-label">
              <span>{type === "expense" ? "总支出" : "总收入"}</span>
              <strong>{money(total, currency)}</strong>
            </div>
          </div>
        </div>
        <div className="legend">
          {groups.length ? (
            groups.map(({ name, color, share, value }) => (
              <div className="legend-row" key={name}>
                <i style={{ background: color }} />
                <strong>{name}</strong>
                <span>{share}%</span>
                <b>{money(value, currency)}</b>
              </div>
            ))
          ) : (
            <p className="muted no-stats">当前筛选条件下没有统计数据</p>
          )}
        </div>
        <p className="note">
          按所选月份和币种统计。通过会员付款登记的外币费用按确认时的汇率计入人民币支出。其他外币账单仍按原币种统计。
        </p>
      </Panel>
    </>
  );
}

function MemberRow({ member, open }) {
  const today = localDatetime().slice(0, 10);
  const days = Math.round(
    (new Date(`${member.nextDate}T12:00`) - new Date(`${today}T12:00`)) /
      86400000,
  );
  let status = "按期使用中";
  if (!member.active) status = "已停用";
  else if (days < 0)
    status = member.autoRenew ? "扣费日期已过 · 请核对" : "已到期";
  else if (days === 0) status = "今天到期／扣费";
  else if (days <= 30) status = `${days} 天后到期／扣费`;
  return (
    <article className="member-item">
      <div className="member-info">
        <strong>{member.name}</strong>
        <b>{money(member.amountMinor, member.currency)}</b>
      </div>
      <p>
        {CYCLE_NAMES[member.cycle]} · {member.nextDate} ·{" "}
        {member.autoRenew ? "自动续费" : "手动续费"}
      </p>
      {member.note && <p>{member.note}</p>}
      {member.currency !== "CNY" && (
        <p className="fx-text">
          {fxLabel(member.amountMinor, member.currency)}
        </p>
      )}
      <span
        className={`due-label ${member.active && days <= 7 ? "due-soon" : ""}`}
      >
        {status}
      </span>
      <div className="action-row">
        <GlassButton className="small" onClick={() => open(member.id)}>
          编辑{member.cycle === "once" ? "会员" : "订阅"}
        </GlassButton>
        <GlassButton className="small" onClick={() => open(member.id, true)}>
          记本次付款
        </GlassButton>
      </div>
    </article>
  );
}

export function Members({ memberships, range, changeRange, open }) {
  const [, refreshRates] = useState(0);
  useEffect(() => {
    let active = true;
    const codes = [
      ...new Set(
        memberships
          .map(({ currency }) => currency)
          .filter((code) => code !== "CNY"),
      ),
    ];
    for (const code of codes)
      getCnyRate(code)
        .catch(() => {})
        .finally(() => {
          if (active) refreshRates((revision) => revision + 1);
        });
    return () => {
      active = false;
    };
  }, [memberships]);
  const visible = memberships
    .filter(({ nextDate }) => range.all || nextDate.startsWith(range.month))
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.nextDate.localeCompare(b.nextDate),
    );
  const members = visible.filter((item) => item.cycle === "once");
  const recurring = visible.filter((item) => item.cycle !== "once");
  const yearly = new Map();
  for (const { currency, amountMinor, cycle, active } of recurring) {
    if (active)
      yearly.set(
        currency,
        (yearly.get(currency) ?? 0) +
          amountMinor * { month: 12, quarter: 4, year: 1 }[cycle],
      );
  }
  let cny = 0;
  let missing = 0;
  for (const [code, amount] of yearly) {
    if (code === "CNY") cny += amount;
    else if (fxCache.has(code))
      cny += estimateCny(amount, code, fxCache.get(code).rate);
    else missing++;
  }
  return (
    <>
      <div className="page-heading">
        <h1>会员与订阅</h1>
        <MonthFilter range={range} onChange={changeRange} browseFromAll />
      </div>
      <Panel className="members-panel" aria-label="会员与订阅">
        <div className="members-grid">
          <Panel className="member-column" aria-label="会员">
            <PanelHeading title="会员">
              <span className="muted">{members.length} 项</span>
            </PanelHeading>
            {members.length ? (
              members.map((member) => (
                <MemberRow key={member.id} member={member} open={open} />
              ))
            ) : (
              <Empty
                icon="card"
                title={range.all ? "还没有一次性会员" : "本月没有到期会员"}
              />
            )}
          </Panel>
          <Panel className="member-column" aria-label="订阅">
            <PanelHeading title="订阅">
              <span className="muted">{recurring.length} 项</span>
            </PanelHeading>
            {yearly.size > 0 && (
              <div className="member-estimate">
                <span>预计年费用</span>
                <strong>
                  {[...yearly]
                    .map(([code, amount]) => money(amount, code))
                    .join(" · ")}
                </strong>
                <p>
                  {[...yearly]
                    .map(
                      ([code, amount]) => `月均约 ${money(amount / 12, code)}`,
                    )
                    .join(" · ")}
                </p>
                {[...yearly.keys()].some((code) => code !== "CNY") && (
                  <p>
                    人民币参考值 ≈ {money(cny, "CNY")}
                    {missing ? "（部分汇率尚未获取）" : ""}
                  </p>
                )}
              </div>
            )}
            {recurring.length ? (
              recurring.map((member) => (
                <MemberRow key={member.id} member={member} open={open} />
              ))
            ) : (
              <Empty
                icon="clock"
                title={range.all ? "还没有周期订阅" : "本月没有待扣费订阅"}
              />
            )}
          </Panel>
        </div>
        <GlassButton className="wide" onClick={() => open()}>
          <Icon name="plus" size={17} /> 添加会员 / 订阅
        </GlassButton>
      </Panel>
    </>
  );
}

const cardColors = [
  ["#253753", "#536993"],
  ["#693355", "#bc697d"],
  ["#244746", "#4d8670"],
  ["#433370", "#7963ad"],
  ["#594236", "#ad7650"],
];
function CardArtwork({ card, cover, children }) {
  const url = useObjectUrl(cover);
  const seed = [...card.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const [a, b] = cardColors[seed % cardColors.length];
  return (
    <span
      className={`card-artwork ${url ? "has-cover" : ""}`}
      style={{ "--card-a": a, "--card-b": b }}
    >
      {url && <img src={url} alt="" draggable="false" />}
      {children}
    </span>
  );
}

export function Cards({
  cards,
  covers,
  selectedId,
  select,
  openCard,
  openTopup,
  payWithCard,
  openCover,
}) {
  const selected = cards.find(({ id }) => id === selectedId) ?? cards[0];
  const totals = new Map();
  for (const card of cards)
    totals.set(
      card.currency,
      (totals.get(card.currency) ?? 0) + card.balanceMinor,
    );
  return (
    <>
      <div className="page-heading">
        <h1>卡包</h1>
      </div>
      <div className="wallet-grid">
        <Panel className="wallet-panel" aria-label="钱包">
          <PanelHeading title="钱包">
            <GlassButton
              className="icon-button small"
              aria-label="添加储值卡"
              onClick={() => openCard()}
            >
              <Icon name="plus" />
            </GlassButton>
          </PanelHeading>
          {cards.length ? (
            <>
              <div className="wallet-totals">
                <span className="muted">{cards.length} 张 · 各币种余额</span>
                <strong>
                  {[...totals]
                    .map(([code, amount]) => money(amount, code))
                    .join(" · ")}
                </strong>
              </div>
              <div className="wallet-stack" aria-label="选择储值卡">
                {cards.map((card) => (
                  <button
                    type="button"
                    key={card.id}
                    className="wallet-card"
                    aria-pressed={card.id === selected.id}
                    aria-label={`查看${card.name}`}
                    onClick={() => select(card.id)}
                  >
                    <CardArtwork card={card} cover={covers.get(card.id)}>
                      <span className="card-name">
                        <Icon name="card" size={17} />
                        {card.name}
                      </span>
                      <small className="card-currency">{card.currency}</small>
                    </CardArtwork>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <Empty icon="card" title="钱包还是空的">
              <p>添加礼品卡、交通卡或其他储值卡。</p>
              <GlassButton className="small" onClick={() => openCard()}>
                ＋ 添加储值卡
              </GlassButton>
            </Empty>
          )}
        </Panel>
        <Panel className="wallet-panel" aria-label="卡片详细信息">
          <PanelHeading title="详细信息" />
          {selected ? (
            <div className="card-details page-enter" key={selected.id}>
              <CardArtwork card={selected} cover={covers.get(selected.id)}>
                {!covers.has(selected.id) && (
                  <>
                    <span className="card-name">
                      <Icon name="card" size={17} />
                      {selected.name}
                    </span>
                    <small className="card-currency">{selected.currency}</small>
                  </>
                )}
              </CardArtwork>
              <div className="card-balance">
                <div>
                  <strong>{selected.name}</strong>
                  <span>
                    {moneyDef(selected.currency).name} · {selected.currency}
                  </span>
                </div>
                <div>
                  <span>余额</span>
                  <b>{money(selected.balanceMinor, selected.currency)}</b>
                </div>
              </div>
              <div className="action-row">
                <GlassButton onClick={() => payWithCard(selected.id)}>
                  用卡记账
                </GlassButton>
                <GlassButton onClick={() => openTopup(selected.id)}>
                  充值
                </GlassButton>
                <GlassButton onClick={() => openCard(selected.id)}>
                  调整
                </GlassButton>
              </div>
              <GlassButton
                className="wide cover-button"
                onClick={() => openCover(selected.id)}
              >
                <Icon name="image" size={18} />
                {covers.has(selected.id) ? "更换封面" : "上传封面"}
              </GlassButton>
            </div>
          ) : (
            <Empty icon="card" title="暂无卡片详情">
              <p>添加储值卡后，可在这里查看余额、充值和上传封面。</p>
            </Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
