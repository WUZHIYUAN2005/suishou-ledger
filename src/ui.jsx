import { useEffect, useRef, useState } from "react";
import { CURRENCIES } from "./ledger.js";

const paths = {
  menu: "M4 6h16M4 12h16M4 18h16",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  search: "m21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  up: "m7 14 5-5 5 5",
  down: "m7 10 5 5 5-5",
  left: "m14 6-6 6 6 6",
  right: "m10 6 6 6-6 6",
  income: "M18 6 6 18m0-8v8h8",
  expense: "M6 18 18 6m-8 0h8v8",
  receipt: "M5 3h14v18l-3.5-2-3.5 2-3.5-2L5 21V3Zm3 5h8m-8 4h6",
  card: "M2.5 7A2.5 2.5 0 0 1 5 4.5h14A2.5 2.5 0 0 1 21.5 7v10a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 17V7Zm0 2.5h19m-15 5.25h4",
  image: "M4 5h16v14H4zM4 16l4-4 4 4 3-3 5 5m-5-9h.01",
  auto: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5m-3 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  moon: "M19.8 15.4A8 8 0 0 1 8.6 4.2 8 8 0 1 0 19.8 15.4Z",
  calendar: "M7 3v4m10-4v4M4 9h16M4 5h16v15H4z",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
};

export function Icon({ name, size = 20 }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function GlassButton({
  children,
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button type={type} className={`glass-button ${className}`} {...props}>
      <span className="glass-face">{children}</span>
    </button>
  );
}

export function Panel({ children, className = "", ...props }) {
  return (
    <section className={`glass-panel ${className}`} {...props}>
      <div className="panel-face">{children}</div>
    </section>
  );
}

export function PanelHeading({ title, children }) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Field({ label, children, className = "" }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Select({ children, className = "", ...props }) {
  return (
    <span className={`select-shell ${className}`}>
      <select {...props}>{children}</select>
      <Icon name="down" size={15} />
    </span>
  );
}

export function CurrencySelect({ withAll = false, ...props }) {
  return (
    <Select {...props}>
      {withAll && <option value="all">全部币种</option>}
      {CURRENCIES.map(({ code, name }) => (
        <option key={code} value={code}>
          {name} · {code}
        </option>
      ))}
    </Select>
  );
}

export function Modal({ title, onClose, children, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    dialog.querySelector("[data-initial-focus]")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`sheet ${className}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-face">
        <header className="panel-heading">
          <h2 id="dialog-title">{title}</h2>
          <GlassButton
            className="icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <Icon name="close" />
          </GlassButton>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function useObjectUrl(blob) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setPreview({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return preview?.blob === blob ? preview?.url : null;
}
