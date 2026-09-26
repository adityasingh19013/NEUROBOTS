import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ScrollText, Search } from "lucide-react";
import { api } from "@/api/client";
import LineageDrawer from "@/components/LineageDrawer";
import { useProject } from "@/components/ProjectLayout";
import { Button, Card, Diff, EmptyState, ErrorText, Mono, PageHeader, Pill, SourceChip, Spinner } from "@/components/ui";
import { FIELD_LABELS, STEP_LABELS, fmtDate, fmtTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";

const STEP_TONES: Record<string, "neutral" | "primary" | "success" | "medium" | "low" | "high"> = {
  upload: "neutral", map: "neutral", standardise: "success", validate: "medium", dedupe: "low", merge: "primary",
  link: "low", link_decision: "primary", issue: "medium", compute: "primary", metric: "primary", export: "neutral",
  privacy: "high", project: "neutral",
};
const PAGE = 100;

export default function AuditLog({ embedded = false }: { embedded?: boolean }) {
  return embedded ? <ProjectAudit /> : <GlobalAudit />;
}

function ProjectAudit() {
  return <AuditBody projectId={useProject().id} />;
}

function GlobalAudit() {
  const { data: projects, isLoading } = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const [projectId, setProjectId] = useState<number | null>(null);
  useEffect(() => {
    if (projects?.length && projectId === null) setProjectId(projects[0].id);
  }, [projects, projectId]);

  return (
    <div className="mx-auto max-w-content px-8 py-8">
      {isLoading ? <Spinner /> : !projects?.length ? (
        <Card><EmptyState icon={<ScrollText className="h-6 w-6" />} title="Nothing logged yet">Create a project and upload files to start the audit trail.</EmptyState></Card>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <span className="label">Project</span>
            <select className="select w-auto" value={projectId ?? ""} onChange={(e) => setProjectId(Number(e.target.value))}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {projectId !== null && <AuditBody projectId={projectId} />}
        </>
      )}
    </div>
  );
}

function AuditBody({ projectId }: { projectId: number }) {
  const { user } = useAuth();
  const [step, setStep] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [row, setRow] = useState<number | null>(null);
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => api.project(projectId) });

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const filters = { step: step || undefined, dataset_id: datasetId ? Number(datasetId) : undefined, q: search || undefined };
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", projectId, filters, page],
    queryFn: () => api.audit(projectId, { ...filters, limit: PAGE, offset: page * PAGE }),
  });

  const who = (u: string | null) => (!u ? "System" : u === user?.email ? user.name : u);

  return (
    <div>
      <PageHeader
        title="Everything that happened to your data"
        subtitle="Original files are never changed. Each change below was made on a working copy."
        actions={<Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => api.exportAudit(projectId, filters)}>Export log (CSV)</Button>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <select className="select h-10 w-auto" value={step} onChange={(e) => { setStep(e.target.value); setPage(0); }}>
            <option value="">All steps</option>
            {(data?.steps ?? []).map((s) => <option key={s} value={s}>{STEP_LABELS[s] ?? s}</option>)}
          </select>
          <select className="select h-10 w-auto" value={datasetId} onChange={(e) => { setDatasetId(e.target.value); setPage(0); }}>
            <option value="">All files</option>
            {(project.data?.datasets ?? []).map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
          </select>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
            <input className="input pl-9" placeholder="Search rule, field or note" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="text-[13px] text-muted">{data?.total ?? 0} entries</span>
        </div>
        {isLoading ? <Spinner /> : error ? <div className="p-4"><ErrorText error={error} /></div> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Time</th><th>Step</th><th>Rule</th><th>File · row</th><th>Field</th><th>Before → after</th><th>By</th></tr>
              </thead>
              <tbody>
                {data!.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-[13px] text-muted" title={e.timestamp ?? ""}>
                      {fmtTime(e.timestamp)}<div className="text-[11px]">{fmtDate(e.timestamp)}</div>
                    </td>
                    <td><Pill tone={STEP_TONES[e.step] ?? "neutral"}>{STEP_LABELS[e.step] ?? e.step}</Pill></td>
                    <td><Mono className="text-[12px]">{e.rule}</Mono></td>
                    <td>{e.file ? <SourceChip file={e.file} row={e.row_number} onClick={e.raw_row_id ? () => setRow(e.raw_row_id!) : undefined} /> : <span className="text-muted">—</span>}</td>
                    <td className="text-muted">{e.field ? FIELD_LABELS[e.field] ?? e.field : "—"}</td>
                    <td className="max-w-[360px] py-2">
                      {e.value_before !== null || e.value_after !== null
                        ? (e.step === "standardise" || e.step === "merge" || e.step === "issue" || e.step === "link_decision" || e.step === "map" || e.step === "metric")
                          ? <Diff before={e.value_before} after={e.value_after} />
                          : <Mono className="text-[12px] text-muted">{e.value_after ?? e.value_before}</Mono>
                        : null}
                      {e.note && !e.note.startsWith("column ") && <div className="text-[12px] text-muted">{e.note}</div>}
                    </td>
                    <td className="whitespace-nowrap text-[13px]">{who(e.user)}</td>
                  </tr>
                ))}
                {!data!.entries.length && <tr><td colSpan={7} className="py-10 text-center text-muted">No entries match.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && (
          <div className="flex items-center justify-end gap-3 border-t border-line p-3 text-[13px]">
            <span className="text-muted">Page {page + 1} of {Math.ceil(data.total / PAGE)}</span>
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </Card>
      {row !== null && <LineageDrawer rawRowId={row} onClose={() => setRow(null)} />}
    </div>
  );
}
