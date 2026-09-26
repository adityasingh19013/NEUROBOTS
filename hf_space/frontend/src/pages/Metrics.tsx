import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { useProject } from "@/components/ProjectLayout";
import { Banner, Button, Card, ErrorText, FileIcon, Modal, NextButton, PageHeader, Pill, Spinner } from "@/components/ui";
import type { MetricCard } from "@/types";

const CALC_LABELS: Record<string, string> = {
  count_distinct_people: "Count distinct people",
  count_rows: "Count records",
  people_with_min_events: "People with at least N records",
  mean_difference: "Average difference between two scores",
  ratio: "Ratio of two figures",
};
const ROLE_OPTIONS = ["beneficiary registry", "attendance", "survey"];

function formula(m: MetricCard): string {
  const c = m.calc;
  const f = c.filters ?? {};
  const conds = [f.period && "inside reporting period", f.attended && "marked present", f.linked && "matched to an enrolled person",
    f.people_in && `counted in ${f.people_in}`].filter(Boolean);
  switch (c.type) {
    case "count_distinct_people": return `distinct people in ${c.role}${conds.length ? ` · ${conds.join(" · ")}` : ""}`;
    case "count_rows": return `rows in ${c.role}${conds.length ? ` · ${conds.join(" · ")}` : ""}`;
    case "people_with_min_events": return `people with ≥ ${c.min_events} qualifying records in ${c.base}`;
    case "mean_difference": return `mean(${c.field_a} − ${c.field_b})${c.latest_per_person ? " · latest per person" : ""}`;
    case "ratio": return `${CALC_LABELS[c.numerator?.type] ?? "numerator"} ÷ ${c.denominator}`;
    default: return c.type;
  }
}

function toPayload(ms: MetricCard[]) {
  return ms.map(({ code, name, definition, unit, source_roles, calc, caveat }) => ({ code, name, definition, unit, source_roles, calc, caveat }));
}

export default function Metrics() {
  const project = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["metrics", project.id], queryFn: () => api.metrics(project.id) });
  const [editing, setEditing] = useState<MetricCard | "new" | null>(null);

  const save = useMutation({
    mutationFn: (ms: MetricCard[]) => api.saveMetrics(project.id, toPayload(ms)),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["metrics", project.id] });
      qc.invalidateQueries({ queryKey: ["report", project.id] });
    },
  });
  const compute = useMutation({
    mutationFn: () => api.compute(project.id),
    onSuccess: () => {
      qc.invalidateQueries();
      navigate(`/projects/${project.id}/report`);
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  const metrics = data?.metrics ?? [];
  const filesByRole = (role: string) => project.datasets.filter((d) => d.role === role);

  return (
    <div>
      <PageHeader title="How each number is calculated" subtitle="Everyone reading the report will see these definitions." />
      {!project.processed_at && <div className="mb-4"><Banner tone="warn">Clean the data first – values appear after the Clean &amp; review step.</Banner></div>}

      <div className="grid grid-cols-2 gap-4 max-[1000px]:grid-cols-1">
        {metrics.map((m) => (
          <Card key={m.code} className="flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Pill tone="primary" className="font-mono">{m.code}</Pill>
                <h3 className="text-[16px] font-semibold">{m.name}</h3>
              </div>
              <div className="text-right">
                <div className="text-[24px] font-bold leading-none text-ink">{m.display_value}</div>
                <div className="mt-1 text-[11px] text-muted">{m.unit}</div>
              </div>
            </div>
            <p className="mt-3 text-[14px] leading-relaxed">{m.definition}</p>
            <div className="mt-3 rounded-ctl bg-hover px-3 py-2 font-mono text-[12px] text-muted">{formula(m)}</div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="label !text-[11px]">Uses:</span>
              {(m.source_roles.length ? m.source_roles : [m.calc.role]).flatMap((r) => filesByRole(r).map((d) => (
                <span key={`${r}-${d.id}`} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono text-[11px]">
                  <FileIcon name={d.filename} className="h-3 w-3" />{d.filename}
                </span>
              )))}
            </div>
            {m.excluded > 0 && (
              <div className="mt-3 text-[12px]">
                <span className="label !text-[11px]">Excludes:</span>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {Object.entries(m.excluded_reasons).map(([r, n]) => <li key={r}>· {r} ({n})</li>)}
                </ul>
              </div>
            )}
            {m.caveat && (
              <div className="mt-3 flex gap-2 rounded-ctl border border-medium/30 bg-medium-bg px-3 py-2 text-[13px]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-medium" />{m.caveat}
              </div>
            )}
            <div className="mt-auto flex items-center justify-between pt-4 text-[12px] text-muted">
              <span>Included {m.included} · Excluded {m.excluded}</span>
              <Button variant="link" className="!text-[13px]" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(m)}>Edit</Button>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex justify-between gap-3">
        <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>Add metric</Button>
        <NextButton loading={compute.isPending} disabled={!project.processed_at} onClick={() => compute.mutate()}>
          Calculate &amp; build report
        </NextButton>
      </div>
      {compute.error && <div className="mt-3"><ErrorText error={compute.error} /></div>}

      {editing && (
        <MetricEditor
          metric={editing === "new" ? null : editing}
          all={metrics}
          saving={save.isPending}
          error={save.error}
          onClose={() => { setEditing(null); save.reset(); }}
          onSave={(m) => {
            const list = editing === "new" ? [...metrics, m] : metrics.map((x) => (x.code === (editing as MetricCard).code ? m : x));
            save.mutate(list);
          }}
          onDelete={editing !== "new" ? () => save.mutate(metrics.filter((x) => x.code !== (editing as MetricCard).code)) : undefined}
        />
      )}
    </div>
  );
}

function MetricEditor({ metric, all, onClose, onSave, onDelete, saving, error }: {
  metric: MetricCard | null; all: MetricCard[]; onClose: () => void; onSave: (m: MetricCard) => void; onDelete?: () => void;
  saving: boolean; error: Error | null;
}) {
  const nextCode = `M${Math.max(0, ...all.map((m) => Number(m.code.replace(/\D/g, "")) || 0)) + 1}`;
  const [m, setM] = useState<MetricCard>(metric ?? {
    code: nextCode, name: "", definition: "", unit: "people", source_roles: [], caveat: "",
    calc: { type: "count_distinct_people", role: "attendance", filters: { linked: true, period: true } },
    result_id: null, value: null, display_value: "—", included: 0, excluded: 0, excluded_reasons: {}, detail: {}, computed_at: null,
  });
  const calc = m.calc;
  const filters = calc.filters ?? {};
  const setCalc = (c: Record<string, any>) => setM({ ...m, calc: c });
  const setFilter = (k: string, v: any) => setCalc({ ...calc, filters: { ...filters, [k]: v || undefined } });
  const others = all.filter((x) => x.code !== m.code);

  return (
    <Modal
      title={metric ? `Edit ${metric.code}` : "Add metric"}
      onClose={onClose}
      width="max-w-2xl"
      footer={<>
        {onDelete && <Button variant="danger" className="mr-auto" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>Delete</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={saving} disabled={!m.name.trim() || !m.definition.trim()} onClick={() => onSave(m)}>Save &amp; recalculate</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[100px_1fr_160px] gap-3">
          <label><span className="label">Code</span>
            <input className="input mt-1.5 font-mono" value={m.code} disabled={!!metric} onChange={(e) => setM({ ...m, code: e.target.value.toUpperCase() })} /></label>
          <label><span className="label">Name</span>
            <input className="input mt-1.5" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
          <label><span className="label">Unit</span>
            <select className="select mt-1.5" value={m.unit} onChange={(e) => setM({ ...m, unit: e.target.value })}>
              {Array.from(new Set(["people", "attendances", "sessions", "records", "points on 1-5 scale", "percent", m.unit])).map((u) => <option key={u}>{u}</option>)}
            </select></label>
        </div>
        <label className="block"><span className="label">Plain-language definition (shown next to the number)</span>
          <textarea className="input mt-1.5 h-20 py-2" value={m.definition} onChange={(e) => setM({ ...m, definition: e.target.value })} /></label>

        <div className="rounded-ctl border border-line p-4">
          <div className="label mb-3">Calculation</div>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="text-[12px] text-muted">Type</span>
              <select className="select mt-1" value={calc.type} onChange={(e) => {
                const t = e.target.value;
                if (t === "people_with_min_events") setCalc({ type: t, base: others.find((x) => x.calc.type === "count_rows")?.code ?? "M3", min_events: 2 });
                else if (t === "mean_difference") setCalc({ type: t, role: "survey", field_a: "score_after", field_b: "score_before", valid_range: [1, 5], latest_per_person: true, filters: { linked: true } });
                else if (t === "ratio") setCalc({ type: t, denominator: others[0]?.code ?? "M1", numerator: { type: "count_distinct_people", role: "survey", filters: { linked: true } } });
                else setCalc({ type: t, role: calc.role ?? "attendance", filters: { linked: true } });
              }}>
                {Object.entries(CALC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            {(calc.type === "count_distinct_people" || calc.type === "count_rows" || calc.type === "mean_difference") && (
              <label><span className="text-[12px] text-muted">File role</span>
                <select className="select mt-1" value={calc.role} onChange={(e) => setCalc({ ...calc, role: e.target.value })}>
                  {ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}
                </select></label>
            )}
            {calc.type === "people_with_min_events" && (<>
              <label><span className="text-[12px] text-muted">Based on metric</span>
                <select className="select mt-1" value={calc.base} onChange={(e) => setCalc({ ...calc, base: e.target.value })}>
                  {others.map((x) => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}
                </select></label>
              <label><span className="text-[12px] text-muted">Minimum records per person</span>
                <input type="number" min={1} className="input mt-1" value={calc.min_events}
                  onChange={(e) => setCalc({ ...calc, min_events: Number(e.target.value) })} /></label>
            </>)}
            {calc.type === "ratio" && (
              <label><span className="text-[12px] text-muted">Divide by metric</span>
                <select className="select mt-1" value={calc.denominator} onChange={(e) => setCalc({ ...calc, denominator: e.target.value })}>
                  {others.map((x) => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}
                </select></label>
            )}
          </div>
          {"filters" in calc && (
            <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
              {[["period", "Inside reporting period"], ["attended", "Marked present"], ["linked", "Matched to an enrolled person"]].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={!!filters[k]} onChange={(e) => setFilter(k, e.target.checked)} />{l}
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="block"><span className="label">Caveat (optional)</span>
          <textarea className="input mt-1.5 h-16 py-2" value={m.caveat ?? ""} onChange={(e) => setM({ ...m, caveat: e.target.value })}
            placeholder="e.g. Self-reported; shows reported change, not proven program impact." /></label>
        <p className="text-[12px] text-muted">Use neutral words such as “recorded” or “reported”. Causal claims (“caused”, “proved”) are blocked.</p>
        {error && <ErrorText error={error} />}
      </div>
    </Modal>
  );
}
