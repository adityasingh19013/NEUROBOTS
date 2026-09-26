import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, Link2, ShieldCheck, ShieldAlert } from "lucide-react";
import { api } from "@/api/client";
import ExportModal from "@/components/ExportModal";
import LineageDrawer from "@/components/LineageDrawer";
import { PrivacySwitch, useProject } from "@/components/ProjectLayout";
import TraceDrawer from "@/components/TraceDrawer";
import { Banner, Button, Card, EmptyState, ErrorText, Pill, SeverityBadge, SourceChip, Spinner } from "@/components/ui";
import { fmtDate, fmtPeriod } from "@/lib/format";
import type { MetricCard } from "@/types";

function Section({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title"><span className="mr-2 text-muted">{n}</span>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function ReportPage() {
  const project = useProject();
  const navigate = useNavigate();
  const [trace, setTrace] = useState<number | null>(null);
  const [row, setRow] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const { data: r, error, isLoading } = useQuery({
    queryKey: ["report", project.id, project.metrics_computed_at],
    queryFn: () => api.report(project.id),
    enabled: !!project.metrics_computed_at,
  });

  if (!project.metrics_computed_at) {
    return (
      <Card>
        <EmptyState icon={<Link2 className="h-6 w-6" />} title="No report yet">
          Clean the data and calculate the metrics first.
          <div className="mt-4"><Button onClick={() => navigate(`/projects/${project.id}/metrics`)}>Go to metrics</Button></div>
        </EmptyState>
      </Card>
    );
  }
  if (isLoading) return <Spinner label="Building report…" />;
  if (error || !r) return <ErrorText error={error} />;

  const dq = r.data_quality;
  const allVerified = r.integrity.every((f) => f.verified);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{r.project.name} Report</h1>
          <p className="mt-1 text-muted">Reporting period {fmtPeriod(r.project.period_start, r.project.period_end)}
            {r.project.program && <> · {r.project.program}</>}</p>
        </div>
        <div className="flex items-center gap-4 no-print">
          <PrivacySwitch />
          <Button icon={<Download className="h-4 w-4" />} onClick={() => setExporting(true)}>Export</Button>
        </div>
      </div>
      {dq.pending_decisions > 0 && (
        <div className="mt-4">
          <Banner tone="warn">
            {dq.pending_decisions} match decision{dq.pending_decisions === 1 ? " is" : "s are"} still open, so the figures may change.{" "}
            <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/projects/${project.id}/clean?tab=duplicates`)}>
              Review now
            </button>
          </Banner>
        </div>
      )}

      <Section n={1} title="Headline figures">
        <div className="grid grid-cols-5 gap-4 max-[1200px]:grid-cols-3 max-[800px]:grid-cols-2">
          {r.metrics.map((m) => <MetricTile key={m.code} m={m} onTrace={() => m.result_id && setTrace(m.result_id)} />)}
        </div>
        <p className="mt-3 text-[12px] text-muted">Click any number to see the exact records behind it.</p>
      </Section>

      <Section n={2} title="Definitions">
        <Card padded={false}>
          <table className="table-base">
            <tbody>
              {r.metrics.map((m) => (
                <tr key={m.code}>
                  <td className="w-[240px] py-3 align-top"><span className="font-mono text-muted">{m.code}</span> <span className="font-medium">{m.name}</span></td>
                  <td className="py-3">{m.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section n={3} title="Data quality">
        <div className="flex flex-wrap items-center gap-2">
          {[
            [`${dq.rows_in} rows uploaded`, "neutral"],
            [`${dq.duplicates_merged} duplicate${dq.duplicates_merged === 1 ? "" : "s"} merged`, "neutral"],
            [`${dq.exact_duplicates} exact duplicate${dq.exact_duplicates === 1 ? "" : "s"} removed`, "neutral"],
            [`${dq.unmatched} unmatched`, "medium"],
            [`${dq.issues_total} issues found (${dq.issues_open} open)`, dq.issues_open ? "medium" : "success"],
          ].map(([label, tone], i, arr) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`card px-4 py-3 text-[14px] font-medium ${tone === "medium" ? "!border-medium/30 !bg-medium-bg" : tone === "success" ? "!border-success/30 !bg-success-bg" : ""}`}>
                {label}
              </div>
              {i < arr.length - 1 && <ArrowRight className="h-4 w-4 text-muted" />}
            </div>
          ))}
        </div>
        <Card padded={false} className="mt-4">
          <table className="table-base">
            <thead><tr><th>File</th><th>Role</th><th>Rows</th><th>Issues</th><th>Quality score</th><th>Original unchanged</th></tr></thead>
            <tbody>
              {dq.files.map((f) => {
                const ok = r.integrity.find((x) => x.file === f.file)?.verified;
                return (
                  <tr key={f.dataset_id}>
                    <td><SourceChip file={f.file} /></td>
                    <td className="text-muted">{f.role}</td>
                    <td>{f.rows}</td>
                    <td>{f.issues} <span className="text-muted">({f.open_issues} open)</span></td>
                    <td><Pill tone={f.quality_score >= 90 ? "success" : f.quality_score >= 70 ? "medium" : "high"}>{f.quality_score}/100</Pill></td>
                    <td>{ok ? <span className="inline-flex items-center gap-1 text-success"><ShieldCheck className="h-4 w-4" />SHA-256 verified</span>
                      : <span className="inline-flex items-center gap-1 text-high"><ShieldAlert className="h-4 w-4" />Changed</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section n={4} title="Assumptions">
        <Card>
          <ul className="list-disc space-y-1.5 pl-5">
            {r.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </Card>
      </Section>

      <Section n={5} title="Unresolved issues" aside={<span className="text-[13px] text-muted">{r.unresolved_issues.length} open</span>}>
        <Card padded={false} className="max-h-[420px] overflow-auto">
          {r.unresolved_issues.length ? (
            <table className="table-base">
              <thead><tr><th>Severity</th><th>Issue</th><th>Source</th></tr></thead>
              <tbody>
                {r.unresolved_issues.map((i) => (
                  <tr key={i.id}>
                    <td><SeverityBadge severity={i.severity} /></td>
                    <td className="py-2"><div className="font-medium">{i.type_label}</div><div className="text-[12px] text-muted">{i.message}</div></td>
                    <td>{i.file && <SourceChip file={i.file} row={i.row_number} onClick={() => i.raw_row_id && setRow(i.raw_row_id)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="p-6 text-muted">None – every issue was resolved or accepted with a note.</div>}
        </Card>
      </Section>

      <Section n={6} title="Caveats">
        <div className="rounded-card border border-line bg-hover p-6">
          <ul className="list-disc space-y-1.5 pl-5 text-[14px]">
            {r.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      </Section>

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[12px] text-muted">
        <span>Generated {fmtDate(r.generated_at)} · Source files: {r.integrity.length} · Every figure links to its original rows.</span>
        <span className={allVerified ? "text-success" : "text-high"}>{allVerified ? "All original files unchanged (SHA-256)" : "A source file changed since upload"}</span>
      </footer>

      {trace !== null && <TraceDrawer resultId={trace} onClose={() => setTrace(null)} />}
      {row !== null && <LineageDrawer rawRowId={row} onClose={() => setRow(null)} />}
      {exporting && <ExportModal projectId={project.id} onClose={() => setExporting(false)} />}
    </div>
  );
}

function MetricTile({ m, onTrace }: { m: MetricCard; onTrace: () => void }) {
  const selfReported = /self-reported/i.test(m.caveat ?? "");
  const reviewHint = m.code === "M1" && m.excluded > 0 ? `${m.excluded} need review` : null;
  return (
    <div className="card flex flex-col p-5">
      <button onClick={onTrace} className="group flex items-center gap-2 self-start" title="Click to see source records" disabled={!m.result_id}>
        <span className="trace-num text-[40px] font-bold leading-none">{m.display_value}</span>
        <Link2 className="h-4 w-4 text-trace opacity-70 group-hover:opacity-100" />
      </button>
      <div className="mt-3 font-medium leading-snug">{m.name}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {selfReported && <Pill tone="medium">Self-reported</Pill>}
        {reviewHint && <Pill tone="medium">{reviewHint}</Pill>}
      </div>
      <div className="mt-auto pt-3 text-[12px] text-muted">Included {m.included} · Excluded {m.excluded}</div>
    </div>
  );
}
