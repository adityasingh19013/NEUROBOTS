import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, GitMerge, Link2, Undo2, Users } from "lucide-react";
import { api } from "@/api/client";
import { useProject } from "@/components/ProjectLayout";
import { Button, Card, EmptyState, ErrorText, Mono, Pill, SourceChip, Spinner } from "@/components/ui";
import { FIELD_LABELS, show } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import type { Pair, PairRecord } from "@/types";

function norm(v: unknown) {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function statusPill(p: Pair) {
  if (p.status === "merged") return <Pill tone="success">Merged</Pill>;
  if (p.status === "linked") return <Pill tone="success">Linked</Pill>;
  if (p.status === "separate" || p.status === "rejected") return <Pill>Kept separate</Pill>;
  if (p.band === "suggested") return <Pill tone="success" dot>Suggested merge</Pill>;
  return <Pill tone="medium" dot>Needs review{p.breakdown.phone_missing ? " – no phone number" : ""}</Pill>;
}

export default function Duplicates({ onView }: { onView: (rawRowId: number) => void }) {
  const project = useProject();
  const qc = useQueryClient();
  const { reveal } = usePrivacy();
  const { data, isLoading, error } = useQuery({
    queryKey: ["pairs", project.id, reveal],
    queryFn: () => api.pairs(project.id, reveal),
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const pairs = data?.pairs ?? [];

  useEffect(() => {
    if (!pairs.length) return;
    if (selectedId === null || !pairs.some((p) => p.id === selectedId)) {
      setSelectedId((pairs.find((p) => p.status === "pending") ?? pairs[0]).id);
    }
  }, [pairs, selectedId]);

  const decide = useMutation({
    mutationFn: (v: { id: number; decision: "merge" | "separate" | "link" | "reject" | "undo" }) => api.decide(v.id, v.decision),
    onSuccess: (_, v) => {
      qc.invalidateQueries();
      if (v.decision !== "undo") {
        const next = pairs.find((p) => p.status === "pending" && p.id !== v.id);
        if (next) setSelectedId(next.id);
      }
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorText error={error} />;
  if (!pairs.length) {
    return <Card><EmptyState icon={<Users className="h-6 w-6" />} title="No likely duplicates found">
      Every record looks like a different person.</EmptyState></Card>;
  }
  const sel = pairs.find((p) => p.id === selectedId) ?? pairs[0];

  return (
    <div className="grid grid-cols-[300px_1fr] gap-6 max-[1100px]:grid-cols-1">
      <div className="space-y-2">
        {pairs.map((p) => {
          const name = show(p.record_b.values.full_name);
          const sameName = norm(p.record_a.values.full_name) === norm(p.record_b.values.full_name);
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={clsx("card w-full p-4 text-left transition hover:border-primary/40",
                p.id === sel.id && "border-primary ring-2 ring-primary/15")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{sameName ? `${name} ×2` : name}</span>
                <Mono className="text-muted">{p.score}</Mono>
              </div>
              <div className="mt-1 text-[12px] text-muted">{p.kind === "duplicate" ? "Two intake records" : "Record → enrolled person"}</div>
              <div className="mt-2">{statusPill(p)}</div>
            </button>
          );
        })}
      </div>

      <div>
        <div className="grid grid-cols-2 gap-4 max-[800px]:grid-cols-1">
          <RecordCard title={sel.kind === "link" ? "Record" : "Record A"} rec={sel.kind === "link" ? sel.record_a : sel.record_a}
            fields={sel.fields} other={sel.record_b} onView={onView} />
          <RecordCard title={sel.kind === "link" ? "Enrolled person" : "Record B"} rec={sel.record_b}
            fields={sel.fields} other={sel.record_a} onView={onView} />
        </div>

        <Card className="mt-4">
          <div className="section-title !text-[16px]">Why we think these match</div>
          <ScoreBar pair={sel} />
        </Card>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {sel.status === "pending" ? (
            sel.kind === "duplicate" ? (
              <>
                <Button icon={<GitMerge className="h-4 w-4" />} loading={decide.isPending && decide.variables?.decision === "merge"}
                  onClick={() => decide.mutate({ id: sel.id, decision: "merge" })}>Merge into one person</Button>
                <Button variant="outline" loading={decide.isPending && decide.variables?.decision === "separate"}
                  onClick={() => decide.mutate({ id: sel.id, decision: "separate" })}>Not the same person</Button>
              </>
            ) : (
              <>
                <Button icon={<Link2 className="h-4 w-4" />} loading={decide.isPending && decide.variables?.decision === "link"}
                  onClick={() => decide.mutate({ id: sel.id, decision: "link" })}>Same person – link record</Button>
                <Button variant="outline" loading={decide.isPending && decide.variables?.decision === "reject"}
                  onClick={() => decide.mutate({ id: sel.id, decision: "reject" })}>Not the same person</Button>
              </>
            )
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-success">
                <CheckCircle2 className="h-4 w-4" />
                {sel.status === "merged" ? "Merged" : sel.status === "linked" ? "Linked" : "Kept separate"} by {sel.decided_by}
              </span>
              <Button variant="outline" size="sm" icon={<Undo2 className="h-4 w-4" />} loading={decide.isPending}
                onClick={() => decide.mutate({ id: sel.id, decision: "undo" })}>Undo</Button>
            </>
          )}
          {sel.status === "pending" && (
            <Button variant="link" onClick={() => {
              const idx = pairs.findIndex((p) => p.id === sel.id);
              setSelectedId(pairs[(idx + 1) % pairs.length].id);
            }}>Skip for now</Button>
          )}
        </div>
        {decide.error && <div className="mt-3"><ErrorText error={decide.error} /></div>}
        <p className="mt-3 text-[12px] text-muted">
          {sel.kind === "duplicate"
            ? "Merging keeps both original rows linked to one person. You can undo this later."
            : "Linking counts this record for the enrolled person. Nothing is linked without your confirmation."}
        </p>
      </div>
    </div>
  );
}

function RecordCard({ title, rec, fields, other, onView }: {
  title: string; rec: PairRecord; fields: string[]; other: PairRecord; onView: (id: number) => void;
}) {
  const keys = Array.from(new Set([...fields, ...Object.keys(rec.values)])).filter((k) => k in rec.values || k in other.values);
  return (
    <Card className="!p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="font-semibold">{title}</div>
      </div>
      <SourceChip file={rec.file} row={rec.row} onClick={() => onView(rec.raw_row_id)} />
      <dl className="mt-4 space-y-1">
        {keys.map((k) => {
          const a = rec.values[k];
          const b = other.values[k];
          const differs = k in other.values && show(a) !== show(b);
          return (
            <div key={k} className={clsx("flex justify-between gap-3 rounded px-2 py-1.5 text-[13px]", differs && "bg-medium-bg")}>
              <dt className="text-muted">{FIELD_LABELS[k] ?? k}</dt>
              <dd className="text-right font-mono">{show(a)}</dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

function ScoreBar({ pair }: { pair: Pair }) {
  const b = pair.breakdown;
  const parts = [
    { label: "Phone exact match", pts: b.phone_match, tone: "bg-primary" },
    { label: `Name similarity (${b.name_similarity}%)`, pts: b.name_points, tone: "bg-trace" },
    { label: "Name-only match (no phone)", pts: b.name_only_match ?? 0, tone: "bg-medium" },
    { label: "Same village", pts: b.location_match, tone: "bg-success" },
    { label: "Different phones", pts: b.phone_conflict, tone: "bg-high" },
  ].filter((p) => p.pts !== 0);
  const positive = parts.filter((p) => p.pts > 0);
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-hover">
        {positive.map((p) => <div key={p.label} className={p.tone} style={{ width: `${Math.min(100, p.pts)}%` }} />)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className={clsx("h-2.5 w-2.5 rounded-full", p.tone)} />
            {p.label} <Mono className={p.pts < 0 ? "text-high" : "text-ink"}>{p.pts > 0 ? "+" : ""}{p.pts}</Mono>
          </span>
        ))}
        <span className="ml-auto font-semibold">= <Mono className="!text-[14px]">{pair.score}/100</Mono></span>
      </div>
      <div className="mt-2 text-[12px] text-muted">
        90–100 suggested merge · 70–89 needs a human decision · below 70 treated as different people
        {b.phone_missing && " · without a phone number a match is never higher than 89"}
      </div>
    </div>
  );
}
