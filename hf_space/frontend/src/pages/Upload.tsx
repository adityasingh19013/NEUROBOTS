import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, CloudUpload, Hash } from "lucide-react";
import { api } from "@/api/client";
import { useProject } from "@/components/ProjectLayout";
import { Banner, Button, Card, FileIcon, Mono, NextButton, PageHeader, ReadOnlyPill } from "@/components/ui";
import { fmtBytes, ROLE_LABELS } from "@/lib/format";
import type { Dataset, Role } from "@/types";

const ROLES: Role[] = ["beneficiary registry", "attendance", "survey", "other"];
const MAX_FILES = 10;
const MAX_MB = 10;

export default function Upload() {
  const project = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [errors, setErrors] = useState<{ filename: string; error: string }[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["project", project.id] });

  const upload = useMutation({
    mutationFn: (files: File[]) => api.upload(project.id, files, []),
    onSuccess: (r) => {
      setErrors(r.errors);
      refresh();
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => setErrors([{ filename: "Upload", error: e.message }]),
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: true,
    maxSize: MAX_MB * 1024 * 1024,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    onDrop: (accepted, rejected) => {
      setErrors(rejected.map((r) => ({
        filename: r.file.name,
        error: r.errors[0]?.code === "file-too-large" ? `Larger than ${MAX_MB} MB` : "Only .xlsx, .xls and .csv files are accepted",
      })));
      if (accepted.length) upload.mutate(accepted);
    },
  });

  const datasets = project.datasets;

  return (
    <div>
      <PageHeader title="Upload files" subtitle="Add the spreadsheets and exports you want to combine. Your originals are stored read-only." />

      <div
        {...getRootProps()}
        className={clsx(
          "card flex cursor-pointer flex-col items-center justify-center border-2 border-dashed px-6 py-14 text-center transition",
          isDragActive ? "border-primary bg-primary-light/40" : "border-line hover:border-primary/50 hover:bg-hover/50",
        )}
      >
        <input {...getInputProps()} />
        <div className="mb-4 rounded-full bg-primary-light p-4 text-primary">
          <CloudUpload className="h-8 w-8" strokeWidth={1.5} />
        </div>
        <div className="text-[16px] font-medium">
          {upload.isPending ? "Uploading…" : <>Drag and drop multiple files here, or <span className="text-primary underline">browse</span></>}
        </div>
        <div className="mt-1 text-[13px] text-muted">
          Accepts .xlsx, .xls, .csv · up to {MAX_MB} MB each · up to {MAX_FILES} files
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mt-4 space-y-2">
          {errors.map((e, i) => (
            <Banner key={i} tone="error"><span className="font-mono">{e.filename}</span>: {e.error}</Banner>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {datasets.map((d) => <DatasetCard key={d.id} d={d} onChange={refresh} />)}
      </div>

      <div className="mt-8 flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate("/projects")}>Back</Button>
        <NextButton disabled={!datasets.length} onClick={() => navigate(`/projects/${project.id}/map`)}>
          Next: Map columns
        </NextButton>
      </div>
    </div>
  );
}

function DatasetCard({ d, onChange }: { d: Dataset; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const role = useMutation({ mutationFn: (r: Role) => api.setRole(d.id, r), onSuccess: onChange, onError: (e: Error) => setError(e.message) });
  const sheet = useMutation({ mutationFn: (s: string) => api.selectSheet(d.id, s), onSuccess: onChange, onError: (e: Error) => setError(e.message) });
  const excel = /\.xlsx?$/i.test(d.filename);

  return (
    <Card className="!p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className={clsx("rounded-ctl p-2.5", excel ? "bg-success-bg" : "bg-low-bg")}>
          <FileIcon name={d.filename} className="h-6 w-6" />
        </div>
        <div className="min-w-[220px] flex-1">
          <Mono className="font-medium text-ink">{d.filename}</Mono>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
            <span>{d.row_count} rows</span>
            <span>{d.columns.length} columns</span>
            <span>{fmtBytes(d.size_bytes)}</span>
            {d.version > 1 && <span>version {d.version}</span>}
            <span className="inline-flex items-center gap-1 font-mono" title={`SHA-256 ${d.sha256}`}>
              <Hash className="h-3 w-3" />{d.sha256.slice(0, 10)}…
            </span>
          </div>
        </div>
        <label className="flex items-center gap-2">
          <span className="label">File role</span>
          <select className="select h-9 w-[190px]" value={d.role} onChange={(e) => role.mutate(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        {excel && d.available_sheets.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="label">Sheet</span>
            <select className="select h-9 w-[140px]" value={d.sheet ?? ""} onChange={(e) => sheet.mutate(e.target.value)}>
              {d.available_sheets.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        )}
        <ReadOnlyPill />
        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success">
          <CheckCircle2 className="h-4 w-4" /> Uploaded
        </span>
      </div>
      {error && <div className="mt-3"><Banner tone="error">{error}</Banner></div>}
    </Card>
  );
}
