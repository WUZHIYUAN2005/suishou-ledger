import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import catAvatar from "../assets/cat-avatar.webp";
import cloudIcon from "../assets/icloud-cloud.png";
import { getSnapshot, localMonth, saveCurrency, subscribe, money } from "./ledger.js";
import { putCover, readCovers, removeCover } from "./covers.js";
import { Bills, Cards, inRange, Members, Overview, Stats } from "./pages.jsx";
import {
  CardDialog,
  CoverDialog,
  EntryDialog,
  ManageDialog,
  MemberDialog,
  TopupDialog,
} from "./dialogs.jsx";
import { GlassButton, Icon, Modal } from "./ui.jsx";
import "./styles.css";

const VIEWS = [
  ["overview", "总览"],
  ["bills", "账单"],
  ["stats", "统计"],
  ["members", "订阅"],
  ["cards", "卡包"],
];
const THEME = "suishou-ledger.theme.v1";
const THEMES = ["system", "light", "dark"];
const THEME_NAMES = { system: "跟随系统", light: "浅色", dark: "深色" };
const THEME_ICONS = { system: "auto", light: "sun", dark: "moon" };

function currentView() {
  const hash = location.hash.slice(1);
  return VIEWS.find(([id]) => id === hash)?.[0] ?? "overview";
}

function savedTheme() {
  try {
    const value = localStorage.getItem(THEME);
    return THEMES.includes(value) ? value : "system";
  } catch (_) {
    return "system";
  }
}

function useTheme() {
  const [mode, setMode] = useState(savedTheme);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = mode === "dark" || (mode === "system" && query.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]').content = dark
        ? "#171725"
        : "#f5eff8";
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [mode]);
  return [
    mode,
    () => {
      const next = THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length];
      try {
        localStorage.setItem(THEME, next);
      } catch (_) {
        /* Preference persistence is optional. */
      }
      setMode(next);
    },
  ];
}

function App() {
  const ledger = useSyncExternalStore(subscribe, getSnapshot);
  const [view, setView] = useState(currentView);
  const [range, setRange] = useState(() => ({
    month: localMonth(),
    all: false,
  }));
  const [memberRange, setMemberRange] = useState(() => ({
    month: localMonth(),
    all: true,
  }));
  const [filters, setFilters] = useState({
    type: "all",
    category: "all",
    currency: "all",
    sort: "newest",
  });
  const [search, setSearch] = useState("");
  const [statsType, setStatsType] = useState("expense");
  const [modal, setModal] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [covers, setCovers] = useState(() => new Map());
  const [message, setMessage] = useState("");
  const [theme, cycleTheme] = useTheme();
  const toastTimer = useRef(null);
  const modalTrigger = useRef(null);
  const selectedViewIndex = VIEWS.findIndex(([id]) => id === view);

  // v29: publish read-only aggregate values to the visual sidebar.
  // No storage format, import/export, Drive OAuth or ledger actions are altered.
  useEffect(() => {
    const currentMonth = localMonth();
    const currentRows = ledger.records.filter((row) => row.occurredAt.startsWith(currentMonth));
    const statsRows = currentRows.filter((row) => row.currency === ledger.statsCurrency);
    const total = (type) => statsRows.filter((row) => row.type === type)
      .reduce((sum, row) => sum + row.amountMinor, 0);
    const display = {
      income: money(total("income"), ledger.statsCurrency),
      expense: money(total("expense"), ledger.statsCurrency),
      count: String(currentRows.length) + " 笔",
      zero: String(currentRows.filter((row) => row.amountMinor === 0).length) + " 笔",
      members: String(ledger.memberships.length) + " 项",
      cards: String(ledger.cards.length) + " 张",
    };
    window.__suishouV29Summary = display;
    window.dispatchEvent(new CustomEvent("suishou-v29-summary", { detail: display }));
  }, [ledger]);

  useEffect(() => {
    const onHash = () => {
      setView(currentView());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    let active = true;
    const load = () =>
      readCovers()
        .then((items) => {
          if (active) setCovers(items);
        })
        .catch((error) => console.warn("无法载入卡片封面", error));
    load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
    };
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function go(id) {
    if (currentView() !== id) history.pushState(null, "", `#${id}`);
    setView(id);
    window.scrollTo(0, 0);
  }
  function open(kind, id, extra) {
    if (!modal) modalTrigger.current = document.activeElement;
    setModal({ kind, id, ...extra });
  }
  function close() {
    setModal(null);
    const trigger = modalTrigger.current;
    requestAnimationFrame(() => {
      const fallback = document.getElementById(`tab-${view}`);
      const target = trigger?.getClientRects().length ? trigger : fallback;
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    });
  }
  function notify(text) {
    setMessage(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 2400);
  }
  function done(text) {
    close();
    notify(text);
  }
  async function updateCover(id, blob) {
    if (blob && !getSnapshot().cards.some((card) => card.id === id))
      throw new Error("此卡已被移除，请重新选择。");
    if (blob) await putCover(id, blob);
    else await removeCover(id);
    setCovers((previous) => {
      const next = new Map(previous);
      if (blob) next.set(id, blob);
      else next.delete(id);
      return next;
    });
  }
  function switchWithKeys(event) {
    const offsets = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in offsets) && event.key !== "Home" && event.key !== "End")
      return;
    event.preventDefault();
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? VIEWS.length - 1
          : (selectedViewIndex + offsets[event.key] + VIEWS.length) %
            VIEWS.length;
    const [id] = VIEWS[index];
    go(id);
    document.getElementById(`tab-${id}`).focus({ preventScroll: true });
  }

  const records = useMemo(
    () => inRange(ledger.records, range),
    [ledger.records, range],
  );
  // Keep the selected edit target even if a sync removes it while the dialog is open.
  const current = modal?.item;
  let dialog;
  if (modal?.kind === "entry")
    dialog = (
      <EntryDialog
        record={current}
        cardId={modal.cardId}
        cards={ledger.cards}
        onClose={close}
        done={done}
      />
    );
  if (modal?.kind === "edit-card")
    dialog = (
      <CardDialog
        card={current}
        onClose={close}
        done={done}
        select={setSelectedCard}
        dropCover={(id) => updateCover(id, null)}
      />
    );
  if (modal?.kind === "topup" && current)
    dialog = <TopupDialog card={current} onClose={close} done={done} />;
  if (modal?.kind === "member")
    dialog = (
      <MemberDialog
        member={current}
        pay={modal.pay ?? false}
        onClose={close}
        done={done}
      />
    );
  if (modal?.kind === "cover" && current)
    dialog = (
      <CoverDialog
        card={current}
        existing={covers.get(current.id)}
        update={updateCover}
        onClose={close}
        done={done}
      />
    );
  if (modal?.kind === "cloud" || modal?.kind === "manage")
    dialog = (
      <ManageDialog
        cloudOnly={modal.kind === "cloud"}
        ledger={ledger}
        onClose={close}
        done={done}
        notify={notify}
      />
    );
  if (modal?.kind === "menu")
    dialog = (
      <Modal title="随手账本" onClose={close} className="navigation-dialog">
        <nav className="menu-list" aria-label="全部页面">
          {VIEWS.map(([id, label]) => (
            <GlassButton
              key={id}
              aria-current={view === id ? "page" : undefined}
              className={view === id ? "selected" : ""}
              onClick={() => {
                go(id);
                close();
              }}
            >
              {label}
              <Icon name="right" size={15} />
            </GlassButton>
          ))}
          <GlassButton onClick={() => open("cloud")}>
            Google Drive 同步
            <Icon name="right" size={15} />
          </GlassButton>
          <GlassButton onClick={() => open("manage")}>
            数据管理与备份
            <Icon name="right" size={15} />
          </GlassButton>
        </nav>
      </Modal>
    );

  const openEntry = (id) =>
    open("entry", id, {
      item: ledger.records.find((record) => record.id === id),
    });
  const openCardModal = (kind, id) =>
    open(kind, id, { item: ledger.cards.find((card) => card.id === id) });
  const screens = {
    overview: (
      <Overview
        records={records}
        currency={ledger.statsCurrency}
        range={range}
        changeRange={setRange}
        search={search}
        openEntry={openEntry}
        showBills={() => go("bills")}
      />
    ),
    bills: (
      <Bills
        records={records}
        hasAny={!!ledger.records.length}
        range={range}
        changeRange={setRange}
        filters={filters}
        changeFilters={setFilters}
        search={search}
        changeSearch={setSearch}
        openEntry={openEntry}
      />
    ),
    stats: (
      <Stats
        records={records}
        range={range}
        changeRange={setRange}
        currency={ledger.statsCurrency}
        changeCurrency={saveCurrency}
        type={statsType}
        changeType={setStatsType}
      />
    ),
    members: (
      <Members
        memberships={ledger.memberships}
        range={memberRange}
        changeRange={setMemberRange}
        open={(id, pay) =>
          open("member", id, {
            pay,
            item: ledger.memberships.find((member) => member.id === id),
          })
        }
      />
    ),
    cards: (
      <Cards
        cards={ledger.cards}
        covers={covers}
        selectedId={selectedCard}
        select={setSelectedCard}
        openCard={(id) => openCardModal("edit-card", id)}
        openTopup={(id) => openCardModal("topup", id)}
        payWithCard={(id) => open("entry", null, { cardId: id })}
        openCover={(id) => openCardModal("cover", id)}
      />
    ),
  };

  return (
    <>
      <div className="app-shell">
        <header className="top-bar">
          <GlassButton
            className="icon-button menu-trigger"
            aria-label="打开页面菜单"
            aria-haspopup="dialog"
            onClick={() => open("menu")}
          >
            <Icon name="menu" size={22} />
          </GlassButton>
          <div className="brand">
            <GlassButton
              className="avatar-button"
              aria-label="账本数据管理"
              onClick={() => open("manage")}
            >
              <img src={catAvatar} alt="" width="45" height="45" />
            </GlassButton>
            <strong>随手账本</strong>
          </div>
          <GlassButton
            className={`icon-button cloud-trigger cloud-${ledger.cloudStatus}`}
            aria-label="Google Drive 云端同步"
            aria-haspopup="dialog"
            title={ledger.cloudMessage}
            onClick={() => open("cloud")}
          >
            <img src={cloudIcon} width="30" height="19" alt="" />
            {ledger.cloudStatus !== "idle" && (
              <span className="cloud-indicator" />
            )}
          </GlassButton>
        </header>
        <nav
          className="view-tabs"
          role="tablist"
          aria-label="切换记账页面"
          onKeyDown={switchWithKeys}
          style={{ "--selected-tab": selectedViewIndex }}
        >
          <span className="active-lens" aria-hidden="true" />
          {VIEWS.map(([id, label]) => (
            <GlassButton
              key={id}
              role="tab"
              id={`tab-${id}`}
              aria-selected={view === id}
              aria-controls={`pane-${id}`}
              tabIndex={view === id ? 0 : -1}
              onClick={() => go(id)}
            >
              {label}
            </GlassButton>
          ))}
        </nav>
        <main className="page-area">
          {ledger.storageError && (
            <p className="form-error" role="alert">
              {ledger.storageError}
            </p>
          )}
          {VIEWS.map(([id]) => (
            <section
              key={id}
              id={`pane-${id}`}
              role="tabpanel"
              aria-labelledby={`tab-${id}`}
              hidden={id !== view}
              className="view-pane page-enter"
            >
              {id === view && screens[id]}
            </section>
          ))}
        </main>
      </div>
      <div className="dock" role="group" aria-label="账本快捷操作">
        <GlassButton
          className="icon-button theme-trigger"
          title={`外观模式：${THEME_NAMES[theme]}`}
          aria-label={`外观模式：${THEME_NAMES[theme]}，点击切换`}
          onClick={cycleTheme}
        >
          <Icon name={THEME_ICONS[theme]} size={21} />
        </GlassButton>
        <form
          className="dock-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            go("bills");
          }}
        >
          <Icon name="search" size={19} />
          <input
            type="search"
            aria-label="搜索近期账单"
            placeholder="搜索近期账单"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              if (view !== "overview" && view !== "bills") go("bills");
            }}
          />
        </form>
        <GlassButton
          className="icon-button primary compose-button"
          aria-label="新建账单"
          title="新建账单"
          onClick={() => openEntry()}
        >
          <Icon name="plus" size={24} />
        </GlassButton>
      </div>
      <div className={`toast ${message ? "visible" : ""}`} role="status">
        {message}
      </div>
      {dialog && <div key={modal.kind}>{dialog}</div>}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);

if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1")
) {
  const register = () =>
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) => console.warn("离线缓存不可用", error));
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
