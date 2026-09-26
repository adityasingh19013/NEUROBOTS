import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Link2, ShieldCheck, X } from "lucide-react";
import { api } from "@/api/client";
import { FIELD_LABELS, STEP_LABELS, show } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { Diff, Drawer, ErrorText, Pill, ReadOnlyPill, SeverityBadge, SourceChip, Spinner, StatusBadge } from "./ui";

/** Raw row → transformations → clean values, for one original record (FR-7.2 / FR-8). */
export function LineageBody({ rawRowId, onBack }: { rawRowId: number; onBack?: () => void }) {
  const { reveal } = usePrivacy();
  const { data, error, isLoading } = useQuery({
    queryKey: ["lineage", rawRowId, reveal],
    queryFn: () => api.lineage(rawRowId, reveal),
  });
  if (isLoading) return <Spinner />;
  if (error || !data) return <div className="p-6"><ErrorText error={error} /></div>;

  const steps = data.transformations.filter((t) => t.step === "standardise" && t.rule !== "run_started");
  const other = data.transformations.filter((t) => t.step !== "standardise" && t.step !== "validate");

  return (
    <div className="space-y-6">
      {onBack && (
        <button onClick={onBack} className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SourceChip file={data.file} row={data.row} sheet={data.sheet} />
        <ReadOnlyPill />
        {data.masked && <Pill><ShieldCheck className="h-3 w-3" />Personal data masked</Pill>}
      </div>

      <section>
        <div className="label mb-2">1 · Original values (as uploaded)</div>
        <table className="w-full overflow-hidden rounded-ctl border border-line text-[13px]">
          <tbody>
            {Object.entries(data.original_values).map(([col, v]) => (
              <tr key={col} className="border-b border-line last:border-0">
                <td className="w-2/5 bg-hover/60 px-3 py-2 font-mono text-[12px] text-muted">{col}</td>
                <td className="px-3 py-2 font-mono">{show(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <div className="label mb-2">2 · Changes made on the working copy ({steps.length})</div>
        {steps.length ? (
          <ul className="space-y-2">
            {steps.map((t) => (
              <li key={t.id} className="rounded-ctl border border-line px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
                  <span>{FIELD_LABELS[t.field ?? ""] ?? t.field}</span>
                  <span className="font-mono">{t.rule}</span>
                </div>
                <div className="mt-1"><Diff before={t.value_before} after={t.value_after} /></div>
                {t.note && !t.note.startsWith("column ") && <div className="mt-1 text-[12px] text-medium">{t.note}</div>}
              </li>
            ))}
          </ul>
        ) : <div className="text-[13px] text-muted">No formatting changes were needed.</div>}
      </section>

      <section>
        <div className="label mb-2">3 · Clean values used in calculations</div>
        {data.clean_values ? (
          <table className="w-full overflow-hidden rounded-ctl border border-line text-[13px]">
            <tbody>
              {Object.entries(data.clean_values).map(([f, v]) => (
                <tr key={f} className="border-b border-line last:border-0">
                  <td className="w-2/5 bg-hover/60 px-3 py-2 text-[12px] text-muted">{FIELD_LABELS[f] ?? f}</td>
                  <td className="px-3 py-2 font-mono">{show(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-[13px] text-muted">Not processed yet.</div>}
        {data.excluded && <div className="mt-2"><Pill tone="neutral">Excluded: {data.exclude_reason}</Pill></div>}
        {data.link && data.link.status && data.role !== "beneficiary registry" && (
          <div className="mt-2 flex items-center gap-2 text-[13px]">
            <Link2 className="h-4 w-4 text-muted" />
            {data.link.status === "unmatched" ? <span className="text-medium">Not matched to an enrolled person</span> :
              data.link.status === "review" ? <span className="text-medium">Match waiting for review (score {data.link.score})</span> :
                <span>Linked to <span className="font-mono">{data.link.person_name}</span> · score {data.link.score}</span>}
          </div>
        )}
      </section>

      {data.issues.length > 0 && (
        <section>
          <div className="label mb-2">Issues on this row</div>
          <ul className="space-y-2">
            {data.issues.map((i) => (
              <li key={i.id} className="flex items-start gap-2 rounded-ctl border border-line px-3 py-2 text-[13px]">
                <SeverityBadge severity={i.severity} />
                <div className="flex-1">
                  <div className="font-medium">{i.type_label}</div>
                  <div className="text-muted">{i.message}</div>
                </div>
                <StatusBadge status={i.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {other.length > 0 && (
        <section>
          <div className="label mb-2">Decisions & links</div>
          <ul className="space-y-1 text-[13px]">
            {other.map((t) => (
              <li key={t.id} className="flex gap-2">
                <Pill className="!text-[11px]">{STEP_LABELS[t.step] ?? t.step}</Pill>
                <span className="font-mono text-[12px]">{t.rule}</span>
                <span className="text-muted">{t.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="break-all font-mono text-[11px] text-muted">File SHA-256 {data.dataset_sha256}</div>
    </div>
  );
}

export default function LineageDrawer({ rawRowId, onClose }: { rawRowId: number; onClose: () => void }) {
  return (
    <Drawer onClose={onClose} width={520}>
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 className="section-title">Original row</h2>
        <button onClick={onClose} className="rounded-ctl p-1 text-muted hover:bg-hover" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <LineageBody rawRowId={rawRowId} />
      </div>
    </Drawer>
  );
}
