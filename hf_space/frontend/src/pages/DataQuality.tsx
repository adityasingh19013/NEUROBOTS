import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, Sparkles } from "lucide-react";
import { api } from "@/api/client";
import LineageDrawer from "@/components/LineageDrawer";
import { PrivacySwitch, useProject } from "@/components/ProjectLayout";
import {
  Banner, Button, Card, Diff, EmptyState, ErrorText, Modal, NextButton, PageHeader, SeverityBadge, SourceChip,
  Spinner, StatCard, StatusBadge, Tabs,
} from "@/components/ui";
import { FIELD_LABELS, fmtTime } from "@/lib/format";
import type { Issue, IssueStatus } from "@/types";
import Duplicates from "./Duplicates";

type Tab = "issues" | "duplicates" | "changes";

export default function DataQuality() {
  const project = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "issues";
  const [lineage, setLineage] = useState<number | null>(null);

  const processed = !!project.processed_at;
  const dq = useQuery({ queryKey: ["dq", project.id], queryFn: () => api.dataQuality(project.id), enabled: processed });
  const pairs = useQuery({ queryKey: ["pairs", project.id, false], queryFn: () => api.pairs(project.id), enabled: processed });
  const changes = useQuery({
    queryKey: ["changes", project.id, project.processed_at],
    queryFn: () => api.audit(project.id, { step: "standardise", limit: 5000 }),
    enabled: processed,
  });

  const run = useMutation({
    mutationFn: () => api.process(project.id),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!processed) {
    return (
      <div>
        <PageHeader title="Clean & review" subtitle="Standardise formats, check for problems and find duplicate people." />
        <Card>
          <EmptyState icon={<Sparkles className="h-6 w-6" />} title="Data not cleaned yet">
            Cleaning works on a copy of your data. Original files are never changed.
            <div className="mt-4 flex justify-center gap-3">
              <Button variant="outline" onClick={() => navigate(`/projects/${project.id}/map`)}>Review column mapping</Button>
              <Button loading={run.isPending} onClick={() => run.mutate()}>Clean data now</Button>
            </div>
            {run.error && <div className="mt-4"><ErrorText error={run.error} /></div>}
          </EmptyState>
        </Card>
      </div>
    );
  }

  const latestRun = changes.data?.last_run_id;
  const changeEntries = (changes.data?.entries ?? []).filter((e) => e.run_id === latestRun && e.rule !== "run_started");
  const dupPairs = pairs.data?.pairs ?? [];
  const pending = pairs.data?.pending ?? 0;
  const d = dq.data;

  return (
    <div>
      <PageHeader
        title="Clean & review"
        subtitle={<>Last cleaned {fmtTime(project.processed_at)} · raw files untouched</>}
        actions={<>
          <PrivacySwitch />
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={run.isPending} onClick={() => run.mutate()}>
            Re-run cleaning
          </Button>
        </>}
      />

      <div className="mb-6 grid grid-cols-5 gap-4 max-[1100px]:grid-cols-3">
        <StatCard label="Rows uploaded" value={d?.rows_in ?? "–"} hint={`${d?.files.length ?? 0} files`} />
        <StatCard label="Issues found" value={d?.issues_total ?? "–"} tone="high" hint={`${d?.issues_open ?? 0} open`}
          onClick={() => setParams({ tab: "issues" })} />
        <StatCard label="Duplicate people" value={dupPairs.filter((p) => p.kind === "duplicate").length} tone="medium"
          hint={`${d?.duplicates_merged ?? 0} merged`} onClick={() => setParams({ tab: "duplicates" })} />
        <StatCard label="Unmatched records" value={d?.unmatched ?? "–"} tone="medium" hint="not counted in metrics" />
        <StatCard label="Values standardised" value={changeEntries.length} tone="success" hint="on the working copy"
          onClick={() => setParams({ tab: "changes" })} />
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { id: "issues", label: "Issues" },
          { id: "duplicates", label: <>Duplicates ({dupPairs.length}){pending > 0 && <span className="ml-1.5 rounded-full bg-medium px-1.5 text-[11px] text-white">{pending}</span>}</> },
          { id: "changes", label: `Changes made (${changeEntries.length})` },
        ]}
      />
      <div className="mt-6">
        {tab === "issues" && <IssuesTab onView={setLineage} />}
        {tab === "duplicates" && <Duplicates onView={setLineage} />}
        {tab === "changes" && (changes.isLoading ? <Spinner /> : (
          <Card padded={false} className="max-h-[620px] overflow-auto">
            <table className="table-base">
              <thead><tr><th>Rule</th><th>File · row</th><th>Field</th><th>Before → after</th><th>Note</th></tr></thead>
              <tbody>
                {changeEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="font-mono text-[12px]">{e.rule}</td>
                    <td>{e.file && <SourceChip file={e.file} row={e.row_number} onClick={() => e.raw_row_id && setLineage(e.raw_row_id)} />}</td>
                    <td className="text-muted">{FIELD_LABELS[e.field ?? ""] ?? e.field}</td>
                    <td><Diff before={e.value_before} after={e.value_after} /></td>
                    <td className="text-[12px] text-muted">{e.note?.startsWith("column ") ? "" : e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <div className="text-[13px] text-muted">
          {pending > 0 ? `${pending} match decision${pending === 1 ? "" : "s"} still waiting – undecided pairs are counted separately.` : "All match decisions made."}
        </div>
        <NextButton onClick={() => navigate(`/projects/${project.id}/metrics`)}>Next: Metrics</NextButton>
      </div>
      {lineage !== null && <LineageDrawer rawRowId={lineage} onClose={() => setLineage(null)} />}
    </div>
  );
}

function IssuesTab({ onView }: { onView: (rawRowId: number) => void }) {
  const project = useProject();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [file, setFile] = useState("");
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<{ issue: Issue; status: IssueStatus } | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ["issues", project.id], queryFn: () => api.issues(project.id) });
  const issues = useMemo(() => (data?.issues ?? []).filter((i) =>
    (!file || String(i.dataset_id) === file) && (!type || i.type === type) && (!severity || i.severity === severity) &&
    (!status || i.status === status) &&
    (!search || `${i.message} ${i.value ?? ""} ${i.file} ${i.row_number} ${i.type_label}`.toLowerCase().includes(search.toLowerCase())),
  ), [data, file, type, severity, status, search]);

  const update = useMutation({
    mutationFn: (v: { id: number; status: IssueStatus; note?: string }) => api.updateIssue(v.id, v.status, v.note),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["issues", project.id] });
      qc.invalidateQueries({ queryKey: ["dq", project.id] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  const types = Array.from(new Set((data?.issues ?? []).map((i) => i.type)));

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
          <input className="input pl-9" placeholder="Search issues" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="select h-10 w-auto" value={file} onChange={(e) => setFile(e.target.value)}>
          <option value="">All files</option>
          {project.datasets.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
        </select>
        <select className="select h-10 w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All issue types</option>
          {types.map((t) => <option key={t} value={t}>{data?.types[t] ?? t}</option>)}
        </select>
        <select className="select h-10 w-auto" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          <option>High</option><option>Medium</option><option>Low</option>
        </select>
        <select className="select h-10 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option><option value="resolved">Resolved</option><option value="accepted">Accepted as-is</option>
        </select>
      </div>
      <div className="p-4 pb-0">
        <Banner>We never fill in missing values automatically. Fix the source file and re-upload, or mark an issue as
          “Accepted as-is” with a note. Unresolved issues are listed in the report.</Banner>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="table-base">
          <thead>
            <tr><th>Severity</th><th>Issue</th><th>File · row</th><th>Field</th><th>Value</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id}>
                <td><SeverityBadge severity={i.severity} /></td>
                <td className="max-w-[340px] py-2">
                  <div className="font-medium">{i.type_label}</div>
                  <div className="text-[12px] text-muted">{i.message}</div>
                  {i.note && <div className="mt-0.5 text-[12px] italic text-muted">Note: {i.note}</div>}
                </td>
                <td>{i.file && <SourceChip file={i.file} row={i.row_number} onClick={() => i.raw_row_id && onView(i.raw_row_id)} />}</td>
                <td className="text-muted">{FIELD_LABELS[i.field ?? ""] ?? "—"}</td>
                <td className="font-mono text-[13px]">{i.value ?? (i.field ? "(blank)" : "—")}</td>
                <td><StatusBadge status={i.status} /></td>
                <td className="whitespace-nowrap py-2 text-right">
                  <Button variant="link" className="!text-[13px] !text-trace" onClick={() => i.raw_row_id && onView(i.raw_row_id)}>View row</Button>
                  <div className="mt-0.5 flex justify-end gap-3">
                    {i.status === "open" ? (
                      <>
                        <Button variant="link" className="!text-[12px]" onClick={() => setEditing({ issue: i, status: "accepted" })}>Accept</Button>
                        <Button variant="link" className="!text-[12px]" onClick={() => setEditing({ issue: i, status: "resolved" })}>Resolve</Button>
                      </>
                    ) : (
                      <Button variant="link" className="!text-[12px] !text-muted" onClick={() => update.mutate({ id: i.id, status: "open" })}>Reopen</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!issues.length && <tr><td colSpan={7} className="py-10 text-center text-muted">No issues match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <IssueNoteModal
          issue={editing.issue}
          status={editing.status}
          loading={update.isPending}
          error={update.error}
          onClose={() => setEditing(null)}
          onSave={(note) => update.mutate({ id: editing.issue.id, status: editing.status, note })}
        />
      )}
    </Card>
  );
}

function IssueNoteModal({ issue, status, onClose, onSave, loading, error }: {
  issue: Issue; status: IssueStatus; onClose: () => void; onSave: (note: string) => void; loading: boolean; error: Error | null;
}) {
  const [note, setNote] = useState("");
  const accept = status === "accepted";
  return (
    <Modal
      title={accept ? "Accept as-is" : "Mark as resolved"}
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={loading} disabled={!accept && !note.trim()} onClick={() => onSave(note)}>
          {accept ? "Accept as-is" : "Mark resolved"}
        </Button>
      </>}
    >
      <div className="mb-4 flex items-center gap-2">
        <SeverityBadge severity={issue.severity} />
        <span className="font-medium">{issue.type_label}</span>
        {issue.file && <SourceChip file={issue.file} row={issue.row_number} />}
      </div>
      <p className="mb-4 text-muted">{issue.message}</p>
      <label className="block">
        <span className="label">{accept ? "Reason (recommended)" : "What was done? (required)"}</span>
        <textarea className="input mt-1.5 h-24 py-2" value={note} onChange={(e) => setNote(e.target.value)} autoFocus
          placeholder={accept ? "e.g. Confirmed with field team – age not collected for this person." : "e.g. Corrected in source file, will re-upload next week."} />
      </label>
      <p className="mt-2 text-[12px] text-muted">This decision and note are written to the audit log. The data itself is not changed.</p>
      {error && <div className="mt-3"><ErrorText error={error} /></div>}
    </Modal>
  );
}
