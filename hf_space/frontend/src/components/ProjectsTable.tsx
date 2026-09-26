import { useNavigate } from "react-router-dom";
import { FolderOpen } from "lucide-react";
import { fmtPeriod, fmtRelative } from "@/lib/format";
import type { Project } from "@/types";
import { Button, EmptyState, Pill } from "./ui";

export function projectStatus(p: Project): { tone: "success" | "medium" | "neutral" | "primary"; label: string; next: string; action: string } {
  if (!p.steps.upload) return { tone: "neutral", label: "No files yet", next: "upload", action: "Continue" };
  if (!p.steps.map) return { tone: "primary", label: "Map columns", next: "map", action: "Continue" };
  if (!p.steps.clean) return { tone: "primary", label: "Ready to clean", next: "clean", action: "Continue" };
  const toReview = p.open_issues + p.pending_decisions;
  if (p.pending_decisions > 0 || !p.steps.metrics)
    return { tone: "medium", label: `${toReview} issue${toReview === 1 ? "" : "s"} to review`, next: "clean", action: "Continue" };
  return { tone: "success", label: "Report ready", next: "report", action: "Open report" };
}

export default function ProjectsTable({ projects, onNew }: { projects: Project[]; onNew: () => void }) {
  const navigate = useNavigate();
  if (!projects.length) {
    return (
      <EmptyState icon={<FolderOpen className="h-6 w-6" />} title="No projects yet">
        Create a project for each report you need to prepare.
        <div className="mt-4"><Button onClick={onNew}>+ New report</Button></div>
      </EmptyState>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Project</th>
            <th>Reporting period</th>
            <th>Files</th>
            <th>Status</th>
            <th>Last updated</th>
            <th className="w-[140px]" />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const s = projectStatus(p);
            return (
              <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/projects/${p.id}/${s.next}`)}>
                <td className="font-medium">{p.name}</td>
                <td className="text-muted">{fmtPeriod(p.period_start, p.period_end)}</td>
                <td className="text-muted">{p.file_count} file{p.file_count === 1 ? "" : "s"}</td>
                <td><Pill tone={s.tone} dot>{s.label}</Pill></td>
                <td className="text-muted">{fmtRelative(p.metrics_computed_at || p.processed_at || p.created_at)}</td>
                <td className="text-right">
                  <Button size="sm" variant={s.action === "Open report" ? "outline" : "primary"}
                    onClick={(e) => { e.stopPropagation(); navigate(`/projects/${p.id}/${s.next}`); }}>
                    {s.action}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
