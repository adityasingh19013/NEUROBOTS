import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle, FileText, ScrollText, Table2 } from "lucide-react";
import { api } from "@/api/client";
import { Button, ErrorText, Modal } from "./ui";

type Kind = "pdf" | "csv" | "audit";

const OPTIONS: { id: Kind; title: string; text: string; icon: typeof FileText }[] = [
  { id: "pdf", title: "PDF report", text: "Numbers, definitions, data quality, assumptions and caveats.", icon: FileText },
  { id: "csv", title: "CSV – metrics + pseudonymous IDs", text: "One row per contributing record, with source file and row.", icon: Table2 },
  { id: "audit", title: "Audit log CSV", text: "Every upload, change, decision and calculation.", icon: ScrollText },
];

export default function ExportModal({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("pdf");
  const [mask, setMask] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "audit") await api.exportAudit(projectId);
      else await api.exportReport(projectId, kind, mask);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Export report"
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={busy} onClick={run}>Export {kind === "pdf" ? "PDF" : "CSV"}</Button>
      </>}
    >
      <div className="space-y-2">
        {OPTIONS.map(({ id, title, text, icon: Icon }) => (
          <label key={id} className={clsx("flex cursor-pointer items-start gap-3 rounded-card border p-4 transition",
            kind === id ? "border-primary bg-primary-light/40 ring-1 ring-primary" : "border-line hover:bg-hover")}>
            <input type="radio" name="kind" className="mt-1 accent-primary" checked={kind === id} onChange={() => setKind(id)} />
            <Icon className="mt-0.5 h-5 w-5 text-primary" />
            <span>
              <span className="block font-medium">{title}</span>
              <span className="block text-[13px] text-muted">{text}</span>
            </span>
          </label>
        ))}
      </div>

      {kind !== "audit" && (
        <div className="mt-5 space-y-3">
          <div className="label">Privacy</div>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={mask} onChange={(e) => setMask(e.target.checked)} />
            <span>
              <span className="font-medium">Mask names and phone numbers (recommended)</span>
              <span className="mt-1 block font-mono text-[12px] text-muted">Priya Sharma → P**** S***** · 9000000101 → ******0101</span>
            </span>
          </label>
          {!mask && (
            <div className="flex items-start gap-2 rounded-ctl border border-high/30 bg-high-bg px-3 py-2 text-[13px] text-high">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Include personal data – this export will be recorded in the audit log.
            </div>
          )}
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" className="h-4 w-4" checked disabled />
            Include assumptions, caveats and unresolved issues (always included)
          </label>
        </div>
      )}
      {error ? <div className="mt-4"><ErrorText error={error} /></div> : null}
    </Modal>
  );
}
