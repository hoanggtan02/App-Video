import { useState, type ReactNode } from "react";
import { FILM_STYLES } from "../lib/format";
import type { FilmChoice } from "../lib/actions";

/** "" = let Cowork pick the style */
export function FilmStyleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Style phim">
      <option value="">Style: Cowork tự chọn</option>
      {FILM_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

/** Button that opens a style picker, then confirms a premium film. */
export function FilmButton({ label = "Phim cao cấp", disabled, onConfirm }: {
  label?: string;
  disabled?: boolean;
  onConfirm: (film: FilmChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState("");
  if (!open) {
    return (
      <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => setOpen(true)}
        title="Cowork dựng cả phim bằng lemo-opuscar (30–60 phút mỗi phim)">
        ★ {label}
      </button>
    );
  }
  return (
    <span className="row gap wrap">
      <FilmStyleSelect value={style} onChange={setStyle} />
      <button className="btn btn-primary btn-sm" disabled={disabled}
        onClick={() => { setOpen(false); onConfirm({ style: style || null }); }}>
        Dựng phim
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Hủy</button>
    </span>
  );
}

export function Badge({ tone = "muted", children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Notice({ message }: { message: { text: string; bad?: boolean } | null }) {
  if (!message) return null;
  return <div className={`notice ${message.bad ? "notice-bad" : "notice-ok"}`}>{message.text}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row gap">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}
