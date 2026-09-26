import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import {
  AlertTriangle, ArrowRight, Check, FileSpreadsheet, FileText, Info, Loader2, Lock, X,
} from "lucide-react";
import type { Severity } from "@/types";

// ------------------------------------------------------------------ buttons

type Variant = "primary" | "outline" | "ghost" | "danger" | "link";

export function Button({
  variant = "primary", size = "md", loading, icon, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-ctl font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
        size === "md" ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-primary text-white hover:bg-primary-dark",
        variant === "outline" && "border border-line bg-white text-ink hover:bg-hover",
        variant === "ghost" && "text-muted hover:bg-hover hover:text-ink",
        variant === "danger" && "border border-high/30 bg-white text-high hover:bg-high-bg",
        variant === "link" && "h-auto px-0 text-primary hover:underline",
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function NextButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <Button {...props}>
      {props.children}
      <ArrowRight className="h-4 w-4" />
    </Button>
  );
}

// ------------------------------------------------------------------ surfaces

export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <div className={clsx("card", padded && "p-6", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, tone = "default", hint, onClick }: {
  label: string; value: ReactNode; tone?: "default" | "high" | "medium" | "success" | "trace"; hint?: ReactNode; onClick?: () => void;
}) {
  return (
    <div className={clsx("card p-5", onClick && "cursor-pointer hover:border-primary/40")} onClick={onClick}>
      <div className="label">{label}</div>
      <div className={clsx("mt-2 text-[28px] font-bold leading-none",
        tone === "high" && "text-high", tone === "medium" && "text-medium",
        tone === "success" && "text-success", tone === "trace" && "text-trace")}>{value}</div>
      {hint && <div className="mt-2 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ badges & chips

export function Pill({ tone = "neutral", children, className, dot }: {
  tone?: "neutral" | "high" | "medium" | "low" | "success" | "primary"; children: ReactNode; className?: string; dot?: boolean;
}) {
  return (
    <span className={clsx(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap",
      tone === "neutral" && "bg-hover text-muted",
      tone === "high" && "bg-high-bg text-high",
      tone === "medium" && "bg-medium-bg text-medium",
      tone === "low" && "bg-low-bg text-low",
      tone === "success" && "bg-success-bg text-success",
      tone === "primary" && "bg-primary-light text-primary-dark",
      className,
    )}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tone = severity === "High" ? "high" : severity === "Medium" ? "medium" : "low";
  return <Pill tone={tone} dot>{severity}</Pill>;
}

export function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 90 ? "success" : pct >= 70 ? "medium" : "high";
  return <Pill tone={tone} className="font-mono !text-[11px]">{pct}%</Pill>;
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "open") return <Pill tone="medium">Open</Pill>;
  if (status === "resolved") return <Pill tone="success"><Check className="h-3 w-3" />Resolved</Pill>;
  if (status === "accepted") return <Pill tone="neutral">Accepted as-is</Pill>;
  return <Pill>{status}</Pill>;
}

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const excel = /\.xlsx?$/i.test(name);
  const Icon = excel ? FileSpreadsheet : FileText;
  return <Icon className={clsx("shrink-0", excel ? "text-success" : "text-trace", className ?? "h-4 w-4")} />;
}

export function SourceChip({ file, row, sheet, onClick }: { file: string; row?: number | null; sheet?: string | null; onClick?: () => void }) {
  const El = onClick ? "button" : "span";
  return (
    <El
      onClick={onClick}
      className={clsx("inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-white px-2.5 py-0.5 font-mono text-[12px] text-trace",
        onClick && "hover:border-trace/40 hover:bg-low-bg")}
      title={sheet ? `${file} / ${sheet}` : file}
    >
      <FileIcon name={file} className="h-3.5 w-3.5" />
      <span className="truncate">{file}</span>
      {row != null && <span className="shrink-0 text-muted">· row {row}</span>}
    </El>
  );
}

export function ReadOnlyPill() {
  return <Pill><Lock className="h-3 w-3" />Original – never modified</Pill>;
}

export function Diff({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-mono text-[13px]">
      <span className="text-high line-through decoration-high/60">{before === null || before === "" ? "(blank)" : before}</span>
      <ArrowRight className="h-3.5 w-3.5 text-muted" />
      <span className="text-success">{after === null || after === "" ? "(blank)" : after}</span>
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("font-mono text-[13px]", className)}>{children}</span>;
}

// ------------------------------------------------------------------ feedback

export function Banner({ tone = "info", children, className }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode; className?: string }) {
  const Icon = tone === "warn" || tone === "error" ? AlertTriangle : tone === "success" ? Check : Info;
  return (
    <div className={clsx("flex items-start gap-3 rounded-ctl border px-4 py-3 text-[13px]",
      tone === "info" && "border-low/20 bg-low-bg text-ink",
      tone === "warn" && "border-medium/30 bg-medium-bg text-ink",
      tone === "error" && "border-high/30 bg-high-bg text-high",
      tone === "success" && "border-success/30 bg-success-bg text-ink", className)}>
      <Icon className={clsx("mt-0.5 h-4 w-4 shrink-0", tone === "info" && "text-low", tone === "warn" && "text-medium",
        tone === "success" && "text-success")} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-hover p-3 text-muted">{icon}</div>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-muted">{children}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <Banner tone="error">{error instanceof Error ? error.message : String(error)}</Banner>;
}

// ------------------------------------------------------------------ toggles & tabs

export function Toggle({ checked, onChange, label, icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; icon?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[13px] font-medium text-ink">
      {icon}
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-5 w-9 rounded-full transition", checked ? "bg-primary" : "bg-line")}
      >
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-6 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx("-mb-px border-b-2 px-1 pb-3 text-[14px] font-medium transition",
            value === t.id ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ overlays

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Modal({ title, onClose, children, footer, width = "max-w-lg" }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  useEscape(onClose);
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div className={clsx("card flex max-h-[90vh] w-full flex-col", width)} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="section-title">{title}</h2>
          <button onClick={onClose} className="rounded-ctl p-1 text-muted hover:bg-hover" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, children, width = 480 }: { onClose: () => void; children: ReactNode; width?: number }) {
  useEscape(onClose);
  return (
    <div className="fade-in fixed inset-0 z-40 bg-ink/30" onMouseDown={onClose}>
      <div
        className="drawer-enter absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-line bg-white shadow-xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        {children}
      </div>
    </div>
  );
}
