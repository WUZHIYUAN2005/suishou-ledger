import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BACKUP_FREQUENCIES,
  CATEGORY,
  createBackupFolder,
  disconnectCloud,
  DRIVE_FILE_NAME,
  estimateCny,
  getCnyRate,
  getGoogleTokenFromClick,
  listBackupFolders,
  loadGoogleAuthorization,
  localDatetime,
  money,
  moneyDef,
  parseMoney,
  setBackupFolder,
  setBackupFrequency,
  syncCloud,
} from "./ledger.js";
import {
  amountInput,
  clearRecords,
  deleteCard,
  deleteEntry,
  deleteMember,
  downloadBackup,
  downloadMigrationBackup,
  importBackup,
  saveCard,
  saveEntry,
  saveMember,
  topupCard,
} from "./actions.js";
import { coverBlob, paintCover, readCoverImage } from "./covers.js";
import {
  CurrencySelect,
  Field,
  GlassButton,
  Icon,
  Modal,
  Select,
  useObjectUrl,
} from "./ui.jsx";

const errorText = (error) => error?.message || "操作失败，请重试。";
const categories = (type) =>
  CATEGORY[type].map(({ name }) => (
    <option key={name} value={name}>
      {name}
    </option>
  ));
const dataFrom = (event) =>
  Object.fromEntries(new FormData(event.currentTarget));

function ErrorLine({ error }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}

function FormActions({ save, remove, busy = false }) {
  return (
    <div className="form-actions">
      <GlassButton type="submit" className="primary wide" disabled={busy}>
        {busy ? "正在保存…" : save}
      </GlassButton>
      {remove && (
        <GlassButton
          className="danger wide"
          disabled={busy}
          onClick={remove.onClick}
        >
          {remove.label}
        </GlassButton>
      )}
    </div>
  );
}

export function EntryDialog({ record, cardId, cards, onClose, done }) {
  const preset = cards.find(({ id }) => id === cardId);
  const [type, setType] = useState(record?.type ?? "expense");
  const [currency, setCurrency] = useState(
    record?.currency ?? preset?.currency ?? "CNY",
  );
  const [category, setCategory] = useState(
    record?.category ?? CATEGORY[type][0].name,
  );
  const [paymentCardId, setPayment] = useState(
    record?.paymentCardId ?? cardId ?? "",
  );
  const [error, setError] = useState("");
  const options = cards.filter((card) => card.currency === currency);
  const selectedPayment = options.some(({ id }) => id === paymentCardId)
    ? paymentCardId
    : "";

  function submit(event) {
    event.preventDefault();
    try {
      saveEntry(record?.id, {
        ...dataFrom(event),
        type,
        currency,
        category,
        paymentCardId: selectedPayment,
      });
      done(record ? "修改已保存" : "已记下这笔账");
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  function remove() {
    try {
      if (deleteEntry(record.id)) done("账目已删除");
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  return (
    <Modal title={record ? "编辑账目" : "记一笔"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="stat-tabs" role="group" aria-label="收支类型">
          {["expense", "income"].map((key) => (
            <GlassButton
              key={key}
              className={key === type ? "selected" : ""}
              aria-pressed={key === type}
              onClick={() => {
                setType(key);
                setCategory(CATEGORY[key][0].name);
              }}
            >
              {key === "expense" ? "支出" : "收入"}
            </GlassButton>
          ))}
        </div>
        <div className="field-grid amount-grid">
          <Field label="金额">
            <input
              name="amount"
              inputMode="decimal"
              data-initial-focus
              className="glass-input"
              required
              placeholder={moneyDef(currency).digits ? "0.00" : "0"}
              defaultValue={
                record ? amountInput(record.amountMinor, record.currency) : ""
              }
            />
          </Field>
          <Field label="币种">
            <CurrencySelect
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value);
                setPayment("");
              }}
            />
          </Field>
        </div>
        <div className="field">
          <span>分类</span>
          <div className="chips" role="group" aria-label="选择分类">
            {CATEGORY[type].map((item) => (
              <GlassButton
                key={item.name}
                className={item.name === category ? "selected" : ""}
                aria-pressed={item.name === category}
                onClick={() => setCategory(item.name)}
              >
                <span className="chip-icon" style={{ color: item.color }}>
                  {item.icon}
                </span>
                {item.name}
              </GlassButton>
            ))}
          </div>
        </div>
        <Field label="名称 / 备注">
          <input
            name="name"
            className="glass-input"
            maxLength={80}
            defaultValue={record?.name}
            placeholder={
              preset ? `例如：${preset.name}消费` : "例如：午餐、耳机、兼职工资"
            }
          />
        </Field>
        {type === "expense" && (
          <Field label="支付方式">
            <Select
              value={selectedPayment}
              onChange={(event) => setPayment(event.target.value)}
            >
              <option value="">普通支付（银行卡 / 现金等）</option>
              {options.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name} · {money(card.balanceMinor, card.currency)}
                </option>
              ))}
            </Select>
            {selectedPayment && (
              <small className="note">
                储值卡消费会自动扣余额。编辑或删除账单时会同步调整卡内余额。
              </small>
            )}
          </Field>
        )}
        <Field label="记录时间">
          <input
            name="occurredAt"
            className="glass-input"
            type="datetime-local"
            required
            defaultValue={record?.occurredAt ?? localDatetime()}
          />
        </Field>
        <ErrorLine error={error} />
        <FormActions
          save={record ? "保存修改" : "保存这笔账"}
          remove={record && { label: "删除这笔记录", onClick: remove }}
        />
      </form>
    </Modal>
  );
}

export function CardDialog({ card, onClose, done, select, dropCover }) {
  const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault();
    try {
      const id = saveCard(card?.id, dataFrom(event));
      select(id);
      done("储值卡已保存");
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  function remove() {
    try {
      if (!deleteCard(card.id)) return;
      dropCover(card.id).catch((failure) =>
        console.warn("封面清理失败", failure),
      );
      done("已移除储值卡");
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  return (
    <Modal title={card ? "调整储值卡" : "添加储值卡"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="卡片名称">
          <input
            name="name"
            data-initial-focus
            className="glass-input"
            required
            maxLength={40}
            defaultValue={card?.name}
            placeholder="例如：星巴克星礼卡"
          />
        </Field>
        <div className="field-grid">
          <Field label="币种">
            <CurrencySelect
              name="currency"
              disabled={!!card}
              defaultValue={card?.currency ?? "CNY"}
            />
          </Field>
          <Field label="当前余额">
            <input
              name="balance"
              className="glass-input"
              inputMode="decimal"
              required
              defaultValue={
                card ? amountInput(card.balanceMinor, card.currency) : "0"
              }
            />
          </Field>
        </div>
        <p className="note">
          填写卡片当前的实际余额。调整余额时，历史账单保持原样。
        </p>
        <ErrorLine error={error} />
        <FormActions
          save="保存储值卡"
          remove={card && { label: "删除此卡", onClick: remove }}
        />
      </form>
    </Modal>
  );
}

export function TopupDialog({ card, onClose, done }) {
  const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault();
    try {
      topupCard(card.id, dataFrom(event).amount);
      done("充值已记录");
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  return (
    <Modal title={`充值 · ${card.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="notice">
          现有余额 {money(card.balanceMinor, card.currency)}
          。实际用卡消费时再记支出。
        </p>
        <Field label="充值金额">
          <input
            name="amount"
            data-initial-focus
            className="glass-input"
            inputMode="decimal"
            required
            placeholder="例如 80.00"
          />
        </Field>
        <ErrorLine error={error} />
        <FormActions save="确认充值" />
      </form>
    </Modal>
  );
}

export function MemberDialog({ member, pay, onClose, done }) {
  const [paid, setPaid] = useState(pay);
  const [currency, setCurrency] = useState(member?.currency ?? "CNY");
  const [amount, setAmount] = useState(
    member ? amountInput(member.amountMinor, member.currency) : "",
  );
  const [error, setError] = useState("");
  const [quote, setQuote] = useState(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const amountMinor = parseMoney(amount, currency);
  useEffect(() => {
    if (currency === "CNY") return;
    let active = true;
    getCnyRate(currency, revision > 0).then(
      (rate) => {
        if (active) setQuote({ currency, rate });
      },
      () => {
        if (active) setQuote({ currency, rate: null });
      },
    );
    return () => {
      active = false;
    };
  }, [currency, revision]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const data = dataFrom(event);
    setBusy(true);
    try {
      if (
        await saveMember(member?.id, {
          ...data,
          currency,
          paid,
          active: !!data.active,
          autoRenew: !!data.autoRenew,
        })
      ) {
        done(paid ? "会员已保存，并记入人民币支出" : "会员信息已保存");
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  function remove() {
    try {
      if (deleteMember(member.id)) done("会员已删除");
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  const currentQuote = quote?.currency === currency ? quote : null;
  return (
    <Modal
      title={member ? "编辑会员 / 订阅" : "添加会员 / 订阅"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <Field label="会员 / 平台名称">
          <input
            name="name"
            data-initial-focus
            className="glass-input"
            maxLength={50}
            required
            defaultValue={member?.name}
            placeholder="例如：Spotify、iCloud、视频会员"
          />
        </Field>
        <div className="field-grid">
          <Field label="每周期费用">
            <input
              name="amount"
              className="glass-input"
              inputMode="decimal"
              required
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="币种">
            <CurrencySelect
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            />
          </Field>
        </div>
        {amountMinor !== null && (
          <div className="notice fx-notice" aria-live="polite">
            {currency === "CNY" ? (
              money(amountMinor, "CNY")
            ) : !currentQuote ? (
              "正在获取人民币参考汇率…"
            ) : currentQuote.rate ? (
              <>
                <strong>
                  约{" "}
                  {money(
                    estimateCny(amountMinor, currency, currentQuote.rate.rate),
                    "CNY",
                  )}
                </strong>
                <span>Frankfurter · {currentQuote.rate.date}</span>
              </>
            ) : (
              <>
                汇率暂不可用。
                <GlassButton
                  className="small"
                  onClick={() => {
                    setQuote(null);
                    setRevision(revision + 1);
                  }}
                >
                  重试汇率
                </GlassButton>
              </>
            )}
          </div>
        )}
        <div className="field-grid">
          <Field label="收费周期">
            <Select name="cycle" defaultValue={member?.cycle ?? "month"}>
              <option value="month">每月</option>
              <option value="quarter">每季度</option>
              <option value="year">每年</option>
              <option value="once">一次性 / 非自动续费</option>
            </Select>
          </Field>
          <Field label="下次扣费 / 到期日期">
            <input
              name="nextDate"
              className="glass-input"
              type="date"
              required
              defaultValue={member?.nextDate ?? localDatetime().slice(0, 10)}
            />
          </Field>
        </div>
        <label className="check-row">
          <input
            name="active"
            type="checkbox"
            defaultChecked={member?.active ?? true}
          />{" "}
          当前正在使用
        </label>
        <label className="check-row">
          <input
            name="autoRenew"
            type="checkbox"
            defaultChecked={member?.autoRenew ?? false}
          />{" "}
          已开启自动续费
        </label>
        <Field label="备注（选填）">
          <input
            name="note"
            className="glass-input"
            maxLength={100}
            defaultValue={member?.note}
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={paid}
            onChange={(event) => setPaid(event.target.checked)}
          />{" "}
          同时记入本次付款
        </label>
        <div hidden={!paid}>
          <div className="field-grid">
            <Field label="实际付款时间">
              <input
                name="when"
                className="glass-input"
                type="datetime-local"
                required={paid}
                defaultValue={localDatetime()}
              />
            </Field>
            <Field label="归入支出分类">
              <Select name="category" defaultValue="其他支出">
                {categories("expense")}
              </Select>
            </Field>
          </div>
          <Field label="银行实际扣款人民币（选填）">
            <input
              name="actualCny"
              className="glass-input"
              inputMode="decimal"
              placeholder="留空则按参考汇率折算"
            />
          </Field>
          <p className="note">
            每次确认只生成一笔人民币支出。参考汇率用于估算，填写实际扣款金额可按银行账单入账。
          </p>
        </div>
        <ErrorLine error={error} />
        <FormActions
          save={paid ? "保存并记入本次支出" : "保存会员 / 订阅"}
          busy={busy}
          remove={member && { label: "删除这项会员", onClick: remove }}
        />
      </form>
    </Modal>
  );
}

export function CoverDialog({ card, existing, update, onClose, done }) {
  const [image, setImage] = useState(null);
  const [settings, setSettings] = useState({
    fit: "cover",
    zoom: 1,
    x: 0,
    y: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const existingUrl = useObjectUrl(existing);
  const canvas = useRef(null);
  useLayoutEffect(() => {
    if (image) paintCover(canvas.current, image, settings);
  }, [image, settings]);

  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const loaded = await readCoverImage(file);
      setSettings({ fit: "cover", zoom: 1, x: 0, y: 0 });
      setImage(loaded);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function save(restore = false) {
    setBusy(true);
    setError("");
    try {
      await update(card.id, restore ? null : await coverBlob(canvas.current));
      done(restore ? "已恢复默认封面" : "卡片封面已更新");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`卡片封面 · ${card.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {image ? (
        <canvas
          className="cover-preview"
          ref={canvas}
          width={720}
          height={450}
          aria-label="封面预览"
        />
      ) : (
        existingUrl && (
          <img className="cover-preview" src={existingUrl} alt="当前封面" />
        )
      )}
      <Field label="上传 JPG、PNG 或 WebP（最多 15 MB）">
        <input
          className="glass-input"
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={busy}
          onChange={choose}
        />
      </Field>
      {image && (
        <>
          <Field label="图片适配">
            <Select
              value={settings.fit}
              onChange={(event) =>
                setSettings({ ...settings, fit: event.target.value })
              }
            >
              <option value="cover">自定义裁剪</option>
              <option value="contain">保留整张图片</option>
            </Select>
          </Field>
          {settings.fit === "cover" && (
            <div className="cover-sliders">
              {[
                ["zoom", "缩放", 1, 3],
                ["x", "水平位置", -1, 1],
                ["y", "垂直位置", -1, 1],
              ].map(([key, label, min, max]) => (
                <Field key={key} label={label}>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step=".01"
                    value={settings[key]}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          )}
        </>
      )}
      <p className="note">封面保存在当前浏览器。</p>
      <ErrorLine error={error} />
      <div className="form-actions">
        <GlassButton
          className="primary wide"
          disabled={busy || !image}
          onClick={() => save()}
        >
          保存封面
        </GlassButton>
        {existing && (
          <GlassButton
            className="wide"
            disabled={busy}
            onClick={() => save(true)}
          >
            恢复默认封面
          </GlassButton>
        )}
      </div>
    </Modal>
  );
}

function DriveLocation({ ledger }) {
  const [folders, setFolders] = useState(null);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function change(action) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        当前备份位置：
        <strong>
          {ledger.cloudFolderName || "Google Drive 中的当前文件夹"}
        </strong>
      </p>
      <div className="action-row">
        {!folders && (
          <GlassButton
            disabled={busy || ledger.cloudBusy}
            onClick={() =>
              change(async () => setFolders(await listBackupFolders()))
            }
          >
            {busy ? "正在加载文件夹…" : "更改备份位置"}
          </GlassButton>
        )}
      </div>
      {ledger.cloudFileId && (
        <p>
          <a
            href={`https://drive.google.com/open?id=${encodeURIComponent(ledger.cloudFileId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            在 Google Drive 中打开备份文件
          </a>
        </p>
      )}
      {folders && (
        <>
          <Field label="备份文件夹">
            <Select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={busy || ledger.cloudBusy}
            >
              <option value="">请选择文件夹</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </Select>
          </Field>
          <p>
            可选自己拥有且未共享的已授权文件夹。也可以在 Google Drive
            中移动同一个备份文件。
          </p>
          <div className="action-row">
            <GlassButton
              disabled={!selected || busy || ledger.cloudBusy}
              onClick={() =>
                change(async () => {
                  await setBackupFolder(selected);
                  setMessage(
                    ledger.cloudFileId
                      ? "备份文件位置已更新"
                      : "首次备份位置已设置",
                  );
                  setFolders(null);
                  setSelected("");
                })
              }
            >
              保存位置
            </GlassButton>
            <GlassButton
              disabled={busy}
              onClick={() => {
                setFolders(null);
                setSelected("");
              }}
            >
              取消
            </GlassButton>
          </div>
          <Field label="新建备份文件夹">
            <input
              className="glass-input"
              value={name}
              maxLength={80}
              placeholder="输入新文件夹名称"
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <GlassButton
            disabled={busy || !name.trim()}
            onClick={() =>
              change(async () => {
                const folder = await createBackupFolder(name);
                setFolders((choices) => [...choices, folder]);
                setSelected(folder.id);
                setName("");
                setMessage("文件夹已创建，点击「保存位置」后使用");
              })
            }
          >
            新建文件夹
          </GlassButton>
        </>
      )}
      {message && <p role="status">{message}</p>}
      <ErrorLine error={error} />
    </>
  );
}

function DriveBackupSettings({ ledger }) {
  const [error, setError] = useState("");
  return (
    <section className="management-section" aria-label="备份设置">
      <h3>备份设置</h3>
      <Field label="备份频率">
        <Select
          value={ledger.cloudFrequency}
          onChange={(event) => {
            try {
              setBackupFrequency(event.target.value);
              setError("");
            } catch (_) {
              setError("浏览器未能保存备份频率，请检查存储设置");
            }
          }}
        >
          {Object.entries(BACKUP_FREQUENCIES).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      {ledger.cloudFrequency === "manual" ? (
        <p>点击「立即同步」时备份。</p>
      ) : (
        <p>
          网页在前台且 Google
          授权有效时自动备份。重新连接后，已到期的备份会补做。
        </p>
      )}
      {ledger.cloudLastSync > 0 && (
        <p>
          上次成功同步：{new Date(ledger.cloudLastSync).toLocaleString("zh-CN")}
        </p>
      )}
      {ledger.cloudReady && ledger.cloudChecked ? (
        <DriveLocation key={ledger.cloudSession} ledger={ledger} />
      ) : (
        <p>连接 Google Drive 后可设置备份位置。</p>
      )}
      <ErrorLine error={error} />
    </section>
  );
}

export function ManageDialog({ cloudOnly, ledger, onClose, done, notify }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(cloudOnly ? 1 : 0);
  const [authStatus, setAuthStatus] = useState(cloudOnly ? "loading" : "idle");
  const fileInput = useRef(null);

  useEffect(() => {
    if (!authAttempt) return;
    let active = true;
    loadGoogleAuthorization().then(
      () => {
        if (active) setAuthStatus("ready");
      },
      () => {
        if (active) setAuthStatus("unavailable");
      },
    );
    return () => {
      active = false;
    };
  }, [authAttempt]);

  function connect() {
    // Open the Google popup directly from a click after its script is ready.
    if (getGoogleTokenFromClick()) return;
    setAuthStatus("loading");
    setAuthAttempt((attempt) => attempt + 1);
  }

  async function migrationBackup() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await downloadMigrationBackup();
      notify("迁移备份已准备下载");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function restore(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const count = await importBackup(file);
      if (count !== null) done(`已恢复 ${count} 笔记录`);
    } catch (failure) {
      setError(`导入失败 · ${errorText(failure)}`);
    } finally {
      setBusy(false);
    }
  }
  function clear() {
    try {
      if (clearRecords()) done("账本已清空");
    } catch (failure) {
      setError(errorText(failure));
    }
  }
  return (
    <Modal
      title={cloudOnly ? "云端同步" : "数据管理"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <section className="management-section">
        <h3>Google Drive</h3>
        <p className="notice" role="status">
          {ledger.cloudMessage}
        </p>
        <p>
          使用你的 Google
          账号同步账单、储值卡和会员订阅。首次连接时会请求确认，云端文件名为「
          {DRIVE_FILE_NAME}」。
        </p>
        <div className="action-row">
          <GlassButton
            className="primary"
            onClick={connect}
            disabled={authStatus === "loading" || ledger.cloudBusy}
          >
            {authStatus === "loading"
              ? "正在加载 Google 授权…"
              : authStatus === "unavailable"
                ? "重试加载 Google 授权"
                : ledger.cloudReady
                  ? "重新授权"
                  : "连接 Google Drive"}
          </GlassButton>
          {ledger.cloudReady && (
            <>
              <GlassButton
                disabled={ledger.cloudBusy}
                onClick={() => syncCloud()}
              >
                {!ledger.cloudChecked
                  ? "重新检查"
                  : ledger.cloudFileId
                    ? "立即同步"
                    : "首次备份"}
              </GlassButton>
              <GlassButton onClick={disconnectCloud}>停止同步</GlassButton>
            </>
          )}
        </div>
        {authStatus === "unavailable" && (
          <p role="status">
            暂时无法连接 Google 授权服务。本地账本可以继续使用。
          </p>
        )}
      </section>
      <DriveBackupSettings ledger={ledger} />
      {!cloudOnly && (
        <>
          <section className="management-section">
            <h3>导出账本</h3>
            <p>将收支记录、储值卡余额和会员订阅下载为 JSON。</p>
            <GlassButton
              onClick={() => {
                downloadBackup();
                notify("备份文件已准备下载");
              }}
            >
              导出 JSON 备份
            </GlassButton>
            <div className="action-row" style={{ marginTop: 8 }}>
              <GlassButton disabled={busy} onClick={migrationBackup}>
                导出迁移备份（含封面）
              </GlassButton>
            </div>
          </section>
          <section className="management-section">
            <h3>导入账本</h3>
            <p>恢复备份会覆盖其中包含的数据。建议先导出当前账本。</p>
            <input
              hidden
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              onChange={restore}
            />
            <GlassButton
              disabled={busy}
              onClick={() => fileInput.current.click()}
            >
              {busy ? "正在读取…" : "选择备份文件"}
            </GlassButton>
          </section>
          <section className="management-section">
            <h3>清空账本</h3>
            <p>删除本网页中的收支明细，储值卡余额和会员资料会保留。</p>
            <GlassButton className="danger" disabled={busy} onClick={clear}>
              清空账本
            </GlassButton>
          </section>
        </>
      )}
      <ErrorLine error={error} />
    </Modal>
  );
}
