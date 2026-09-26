import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, Lock, ShieldCheck } from "lucide-react";
import { api } from "@/api/client";
import { useProject } from "@/components/ProjectLayout";
import {
  Banner, Button, Card, ConfidenceBadge, EmptyState, FileIcon, Mono, NextButton, PageHeader, Pill, Spinner,
} from "@/components/ui";
import { usePrivacy } from "@/lib/privacy";
import { show } from "@/lib/format";
import type { CanonicalField, Mapping as MappingT, MappingColumn } from "@/types";

type Draft = Record<number, Record<string, { field: string | null; pii: boolean }>>;
type Selected = { datasetId: number; column: string } | null;

export default function Mapping() {
  const project = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { reveal } = usePrivacy();
  const datasets = project.datasets;

  const fieldsQ = useQuery({ queryKey: ["canonical-fields"], queryFn: api.canonicalFields, staleTime: Infinity });
  const mappingQs = useQueries({
    queries: datasets.map((d) => ({ queryKey: ["mapping", d.id, reveal], queryFn: () => api.mapping(d.id, reveal) })),
  });
  const mappings = mappingQs.map((m) => m.data).filter(Boolean) as MappingT[];
  const loading = fieldsQ.isLoading || mappingQs.some((m) => m.isLoading);

  const [draft, setDraft] = useState<Draft>({});
  const [selected, setSelected] = useState<Selected>(null);
  const [template, setTemplate] = useState(true);

  // Initialise the editable draft from the server mapping once.
  useEffect(() => {
    if (loading || mappings.length !== datasets.length) return;
    setDraft((prev) => {
      if (Object.keys(prev).length) return prev;
      const d: Draft = {};
      mappings.forEach((m) => {
        d[m.dataset_id] = {};
        m.columns.forEach((c) => (d[m.dataset_id][c.source_column] = { field: c.canonical_field, pii: c.is_pii }));
      });
      return d;
    });
    if (!selected && mappings[0]?.columns[0]) {
      const phoneCol = mappings.flatMap((m) => m.columns.map((c) => ({ m, c }))).find(({ c }) => c.canonical_field === "phone");
      const first = phoneCol ?? { m: mappings[0], c: mappings[0].columns[0] };
      setSelected({ datasetId: first.m.dataset_id, column: first.c.source_column });
    }
  }, [loading, mappings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields: CanonicalField[] = fieldsQ.data?.fields ?? [];
  const colInfo = useMemo(() => {
    const map = new Map<string, MappingColumn>();
    mappings.forEach((m) => m.columns.forEach((c) => map.set(`${m.dataset_id}::${c.source_column}`, c)));
    return map;
  }, [mappings]);

  const save = useMutation({
    mutationFn: async () => {
      for (const d of datasets) {
        const cols = Object.entries(draft[d.id] ?? {}).map(([source_column, v]) => ({
          source_column, canonical_field: v.field, is_pii: v.pii,
        }));
        await api.saveMapping(d.id, cols, template);
      }
      return api.process(project.id);
    },
    onSuccess: () => {
      qc.invalidateQueries();
      navigate(`/projects/${project.id}/clean`);
    },
  });

  if (!datasets.length) {
    return <EmptyState icon={<FileIcon name="x.csv" className="h-6 w-6" />} title="No files uploaded yet">Upload files first.</EmptyState>;
  }
  if (loading || !Object.keys(draft).length) return <Spinner label="Matching columns…" />;

  // Rows = canonical fields used by any file, then "ignored" columns.
  const usedFields = fields.filter((f) => datasets.some((d) => Object.values(draft[d.id] ?? {}).some((v) => v.field === f.id)));
  const unusedFields = fields.filter((f) => !usedFields.includes(f));
  const colFor = (datasetId: number, fieldId: string) =>
    Object.entries(draft[datasetId] ?? {}).find(([, v]) => v.field === fieldId)?.[0] ?? null;
  const ignored = datasets.map((d) => Object.entries(draft[d.id] ?? {}).filter(([, v]) => !v.field).map(([c]) => c));

  function assign(datasetId: number, fieldId: string, column: string | null) {
    setDraft((prev) => {
      const cols = { ...prev[datasetId] };
      Object.keys(cols).forEach((c) => { if (cols[c].field === fieldId) cols[c] = { ...cols[c], field: null }; });
      if (column) {
        const pii = fields.find((f) => f.id === fieldId)?.pii ?? false;
        cols[column] = { field: fieldId, pii: pii || cols[column].pii };
      }
      return { ...prev, [datasetId]: cols };
    });
    if (column) setSelected({ datasetId, column });
  }

  function togglePii(fieldId: string) {
    setDraft((prev) => {
      const next: Draft = {};
      const on = !datasets.some((d) => Object.values(prev[d.id] ?? {}).some((v) => v.field === fieldId && v.pii));
      Object.entries(prev).forEach(([dsId, cols]) => {
        next[Number(dsId)] = Object.fromEntries(Object.entries(cols).map(([c, v]) => [c, v.field === fieldId ? { ...v, pii: on } : v]));
      });
      return next;
    });
  }

  const sel = selected ? colInfo.get(`${selected.datasetId}::${selected.column}`) : null;
  const selDs = selected ? datasets.find((d) => d.id === selected.datasetId) : null;
  const allConfirmed = mappings.every((m) => m.confirmed);

  return (
    <div>
      <PageHeader
        title="Match your columns"
        subtitle="We matched columns that mean the same thing across your files. Check and confirm."
        actions={allConfirmed ? <Pill tone="success">Mapping confirmed</Pill> : <Pill tone="medium">Not confirmed yet</Pill>}
      />
      <div className="grid grid-cols-[1fr_260px] gap-6 max-[1100px]:grid-cols-1">
        <Card padded={false} className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="min-w-[150px]">Standard field</th>
                {datasets.map((d) => (
                  <th key={d.id} className="min-w-[190px] normal-case tracking-normal">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink">
                      <FileIcon name={d.filename} className="h-3.5 w-3.5" />{d.filename}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usedFields.map((f) => {
                const pii = datasets.some((d) => Object.values(draft[d.id] ?? {}).some((v) => v.field === f.id && v.pii));
                return (
                  <tr key={f.id}>
                    <td className="py-2">
                      <div className="flex items-center gap-2 font-medium">
                        {f.label.split(" (")[0]}
                        <button onClick={() => togglePii(f.id)} title={pii ? "Personal data – masked in reports (click to change)" : "Mark as personal data"}
                          className={clsx("rounded p-0.5", pii ? "text-medium" : "text-line hover:text-muted")}>
                          <Lock className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    {datasets.map((d) => {
                      const col = colFor(d.id, f.id);
                      const info = col ? colInfo.get(`${d.id}::${col}`) : null;
                      const isSel = selected?.datasetId === d.id && selected.column === col;
                      const changed = info && info.canonical_field !== f.id;
                      return (
                        <td key={d.id} className={clsx("py-2", isSel && "bg-primary-light/50")}>
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <select
                                className={clsx("h-8 w-[140px] appearance-none truncate rounded-ctl border bg-white pl-2 pr-7 font-mono text-[12px]",
                                  col ? "border-line text-ink" : "border-dashed border-line text-muted")}
                                value={col ?? ""}
                                onFocus={() => col && setSelected({ datasetId: d.id, column: col })}
                                onChange={(e) => assign(d.id, f.id, e.target.value || null)}
                              >
                                <option value="">—</option>
                                {d.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-muted" />
                            </div>
                            {col && info && (changed ? <Pill tone="primary" className="!text-[11px]">set by you</Pill> : <ConfidenceBadge value={info.confidence} />)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr>
                <td className="py-2 text-muted">Not used (ignored)</td>
                {datasets.map((d, i) => (
                  <td key={d.id} className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {ignored[i].length ? ignored[i].map((c) => (
                        <button key={c} onClick={() => setSelected({ datasetId: d.id, column: c })}
                          className="rounded-full bg-hover px-2 py-0.5 font-mono text-[11px] text-muted hover:text-ink">{c}</button>
                      )) : <span className="text-[12px] text-muted">—</span>}
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          {unusedFields.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-[13px] text-muted">
              Add a field:
              {unusedFields.map((f) => (
                <select key={f.id} className="h-7 rounded-full border border-dashed border-line bg-white px-2 text-[12px]"
                  value="" onChange={(e) => { const [dsId, col] = e.target.value.split("::"); assign(Number(dsId), f.id, col); }}>
                  <option value="">+ {f.label.split(" (")[0]}</option>
                  {datasets.map((d) => (
                    <optgroup key={d.id} label={d.filename}>
                      {d.columns.map((c) => <option key={c} value={`${d.id}::${c}`}>{c}</option>)}
                    </optgroup>
                  ))}
                </select>
              ))}
            </div>
          )}
        </Card>

        <Card className="h-fit">
          <div className="label">Sample values</div>
          {sel && selDs ? (
            <>
              <div className="mt-2 font-mono text-[14px] font-medium">{sel.source_column}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">{selDs.filename}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Pill>{sel.detected_type}</Pill>
                <Pill>{sel.blank_pct}% blank</Pill>
                <Pill>{sel.distinct_count} distinct</Pill>
              </div>
              <ul className="mt-4 divide-y divide-line rounded-ctl border border-line">
                {(sel.samples ?? []).map((s, i) => (
                  <li key={i} className="px-3 py-2 font-mono text-[13px]">{show(s)}</li>
                ))}
                {!sel.samples?.length && <li className="px-3 py-2 text-muted">No values</li>}
              </ul>
              {sel.reason && <div className="mt-3 text-[12px] text-muted">Why: {sel.reason}</div>}
              {!reveal && draft[selDs.id]?.[sel.source_column]?.pii && (
                <div className="mt-3 flex items-center gap-1.5 text-[12px] text-muted"><ShieldCheck className="h-3.5 w-3.5" />Personal data masked</div>
              )}
            </>
          ) : <div className="mt-3 text-muted">Select a column to preview its values.</div>}
        </Card>
      </div>

      {save.error && <div className="mt-4"><Banner tone="error">{save.error.message}</Banner></div>}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={template} onChange={(e) => setTemplate(e.target.checked)} />
          Save as template for next upload
          <span className="text-[12px] text-muted">(reuses these matches when files with the same columns are uploaded)</span>
        </label>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate(`/projects/${project.id}/upload`)}>Back</Button>
          <NextButton loading={save.isPending} onClick={() => save.mutate()}>Confirm mapping &amp; clean data</NextButton>
        </div>
      </div>
      <p className="mt-3 text-right text-[12px] text-muted">
        Cleaning works on a copy. <Mono className="!text-[12px]">{datasets.length}</Mono> original file(s) stay untouched.
      </p>
    </div>
  );
}
