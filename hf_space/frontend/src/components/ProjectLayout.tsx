import { createContext, useContext } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, ChevronLeft, Lock } from "lucide-react";
import { api } from "@/api/client";
import { fmtPeriod } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import type { Project } from "@/types";
import { ErrorText, Spinner, Toggle } from "./ui";

const STEPS = [
  { path: "upload", label: "Upload", done: (p: Project) => p.steps.upload },
  { path: "map", label: "Map columns", done: (p: Project) => p.steps.map },
  { path: "clean", label: "Clean & review", done: (p: Project) => p.steps.review },
  { path: "metrics", label: "Metrics", done: (p: Project) => p.steps.metrics },
  { path: "report", label: "Report", done: (p: Project) => p.steps.metrics && p.steps.review },
];

const ProjectContext = createContext<Project | null>(null);

export function useProject(): Project {
  const p = useContext(ProjectContext);
  if (!p) throw new Error("useProject outside ProjectLayout");
  return p;
}

export function useProjectId(): number {
  return Number(useParams().projectId);
}

export function PrivacySwitch() {
  const project = useProject();
  const { reveal, setReveal } = usePrivacy();
  return (
    <Toggle
      checked={reveal}
      onChange={(v) => setReveal(v, project.id)}
      label="Show personal data"
      icon={<Lock className="h-4 w-4 text-muted" />}
    />
  );
}

export default function ProjectLayout() {
  const id = useProjectId();
  const { data: project, error, isLoading } = useQuery({ queryKey: ["project", id], queryFn: () => api.project(id) });

  if (isLoading) return <Spinner />;
  if (error || !project) return <div className="p-8"><ErrorText error={error ?? "Project not found"} /></div>;

  return (
    <ProjectContext.Provider value={project}>
      <div className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur no-print">
        <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-4 px-8 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/projects" className="rounded-ctl p-1 text-muted hover:bg-hover" aria-label="All projects">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <div className="truncate font-semibold">{project.name}</div>
              <div className="text-[12px] text-muted">{fmtPeriod(project.period_start, project.period_end)}</div>
            </div>
          </div>
          <Stepper project={project} />
        </div>
      </div>
      <div className="mx-auto max-w-content px-8 py-8">
        <Outlet />
      </div>
    </ProjectContext.Provider>
  );
}

function Stepper({ project }: { project: Project }) {
  return (
    <ol className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const done = s.done(project);
        return (
          <li key={s.path} className="flex items-center">
            {i > 0 && <span className={clsx("mx-1 h-px w-5", done ? "bg-success/50" : "bg-line")} />}
            <NavLink
              to={`/projects/${project.id}/${s.path}`}
              className={({ isActive }) => clsx(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition",
                isActive ? "bg-primary-light text-primary-dark" : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              {({ isActive }) => (
                <>
                  <span className={clsx(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                    isActive ? "bg-primary text-white" : done ? "bg-success text-white" : "border border-line bg-white text-muted",
                  )}>
                    {done && !isActive ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="max-[1280px]:hidden">{s.label}</span>
                </>
              )}
            </NavLink>
          </li>
        );
      })}
    </ol>
  );
}
