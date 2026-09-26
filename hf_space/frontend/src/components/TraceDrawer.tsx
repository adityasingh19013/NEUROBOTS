import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Download, X } from "lucide-react";
import { api, saveBlob } from "@/api/client";
import { csvEscape, show } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import type { Trace, TracePerson, TraceSource } from "@/types";
import { LineageBody } from "./LineageDrawer";
import { Button, Drawer, ErrorText, Mono, Pill, SourceChip, Spinner, Tabs } from "./ui";

function describe(s: TraceSource): string {
  const v = s.values as Record<string, any>;
  if (s.role === "beneficiary registry") return v.event_date ? `Enrolled ${v.event_date}` : "Enrolled – date unknown";
  if (s.role === "attendance") {
    const mark = v.attended === true ? "Present" : v.attended === false ? "Absent" : "Attendance not recorded";
    return `${mark} · ${v.event_date ?? "no date"}${v.session_topic ? ` · ${v.session_topic}` : ""}`;
  }
  if (s.role === "survey") {
    return `Survey · ${v.event_date ?? "no date"} · confidence ${show(v.score_before)} → ${show(v.score_after)}`;
  }
  return "";
}

function traceCsv(t: Trace): string {
  const rows = [["metric", "included", "person_key", "name", "file", "sheet", "row", "note_or_reason"]];
  t.included.forEach((p) => p.sources.forEach((s) =>
    rows.push([t.metric, "yes", p.person_key, p.name, s.file, s.sheet ?? "", String(s.row), s.note ?? ""])));
  t.excluded.forEach((s) =>
    rows.push([t.metric, "no", s.person_key ?? "", s.name ?? "", s.file, s.sheet ?? "", String(s.row), s.reason ?? ""]));
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

export default function TraceDrawer({ resultId, onClose }: { resultId: number; onClose: () => void }) {
  const { reveal } = usePrivacy();
  const { data: t, error, isLoading } = useQuery({ queryKey: ["trace", resultId, reveal], queryFn: () => api.trace(resultId, reveal) });
  const [tab, setTab] = useState<"included" | "excluded">("included");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [row, setRow] = useState<number | null>(null);

  return (
    <Drawer onClose={onClose} width={520}>
      <div className="border-b border-line px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="section-title">{t ? <>{t.metric.replace(/^M\d+\s/, "")} = <span className="text-trace">{t.display_value}</span></> : "Trace"}</h2>
          <button onClick={onClose} className="rounded-ctl p-1 text-muted hover:bg-hover" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {t?.definition && <p className="mt-1 text-[13px] text-muted">{t.definition}</p>}
        {t && t.detail?.numerator !== undefined && (
          <p className="mt-1 font-mono text-[12px] text-muted">{t.detail.numerator} ÷ {t.detail.denominator} ({t.detail.denominator_metric})</p>
        )}
        {t && t.detail?.n !== undefined && (
          <p className="mt-1 font-mono text-[12px] text-muted">sum of differences {t.detail.sum_of_differences} ÷ {t.detail.n} responses</p>
        )}
      </div>
      {row !== null ? (
        <div className="flex-1 overflow-y-auto px-6 py-5"><LineageBody rawRowId={row} onBack={() => setRow(null)} /></div>
      ) : isLoading ? <Spinner /> : error || !t ? <div className="p-6"><ErrorText error={error} /></div> : (
        <>
          <div className="px-6 pt-4">
            <Tabs value={tab} onChange={setTab} tabs={[
              { id: "included", label: `Included (${t.included.length})` },
              { id: "excluded", label: `Excluded (${t.excluded.length})` },
            ]} />
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {tab === "included" && t.included.map((p, i) => (
              <PersonCard key={p.person_id} p={p} open={open[p.person_id] ?? i === 0}
                onToggle={() => setOpen({ ...open, [p.person_id]: !(open[p.person_id] ?? i === 0) })} onView={setRow} />
            ))}
            {tab === "included" && !t.included.length && <div className="py-10 text-center text-muted">No records included.</div>}
            {tab === "excluded" && t.excluded.map((s) => (
              <div key={s.raw_row_id} className="rounded-ctl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <SourceChip file={s.file} row={s.row} />
                  {s.name && <Mono className="text-muted">{s.name}</Mono>}
                </div>
                <div className="mt-2 text-[13px] text-muted line-through decoration-muted/50">{describe(s)}</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <Pill tone="neutral">{s.reason}</Pill>
                  <Button variant="link" className="!text-[13px] !text-trace" onClick={() => setRow(s.raw_row_id)}>View original row</Button>
                </div>
              </div>
            ))}
            {tab === "excluded" && !t.excluded.length && <div className="py-10 text-center text-muted">Nothing was excluded.</div>}
          </div>
          <div className="flex items-center justify-between border-t border-line px-6 py-3">
            <span className="text-[12px] text-muted">{t.masked ? "Names masked · pseudonymous IDs" : "Personal data visible"}</span>
            <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />}
              onClick={() => saveBlob(new Blob([traceCsv(t)], { type: "text/csv" }), `trace_${t.code}.csv`)}>
              Download trace as CSV
            </Button>
          </div>
        </>
      )}
    </Drawer>
  );
}

function PersonCard({ p, open, onToggle, onView }: { p: TracePerson; open: boolean; onToggle: () => void; onView: (id: number) => void }) {
  return (
    <div className="rounded-ctl border border-line">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={onToggle}>
        {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[14px] font-medium">{p.name}</div>
          <div className="font-mono text-[11px] text-muted">ID {p.person_key.slice(0, 4)}…{p.person_key.slice(-2)}</div>
        </div>
        <Pill tone="primary">{p.contributing_rows} {p.contributing_rows === 1 ? "record" : "records"}</Pill>
      </button>
      {open && (
        <ol className="relative mx-4 mb-4 ml-[26px] border-l border-line pl-5">
          {p.sources.map((s) => (
            <li key={s.raw_row_id} className="relative pb-4 last:pb-0">
              <span className={clsx("absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white",
                s.note === "merged duplicate" ? "bg-medium" : s.note === "counted" ? "bg-trace" : "bg-primary")} />
              <SourceChip file={s.file} row={s.row} sheet={s.sheet} />
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                <span>{describe(s)}</span>
                {s.note === "merged duplicate" && <Pill tone="medium">Merged duplicate</Pill>}
              </div>
              <Button variant="link" className="mt-0.5 !text-[12px] !text-trace" onClick={() => onView(s.raw_row_id)}>View original row</Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
