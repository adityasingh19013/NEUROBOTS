import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import NewProjectModal from "@/components/NewProjectModal";
import ProjectsTable from "@/components/ProjectsTable";
import { Button, Card, ErrorText, PageHeader, Spinner, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Dashboard() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: projects, isLoading, error } = useQuery({ queryKey: ["projects"], queryFn: api.projects });

  const isReady = (p: { steps: { metrics: boolean }; pending_decisions: number }) => p.steps.metrics && p.pending_decisions === 0;
  const active = projects?.filter((p) => !isReady(p)).length ?? 0;
  const files = projects?.reduce((n, p) => n + p.file_count, 0) ?? 0;
  const openIssues = projects?.reduce((n, p) => n + p.open_issues, 0) ?? 0;
  const ready = projects?.filter(isReady).length ?? 0;

  return (
    <div className="mx-auto max-w-content px-8 py-8">
      <PageHeader
        title={`Welcome back, ${user?.name?.split(" ")[0] ?? ""}`}
        subtitle="Combine your program files, check them, and build a report funders can verify."
        actions={<Button onClick={() => setOpen(true)}>+ New report</Button>}
      />
      <div className="mb-8 grid grid-cols-4 gap-4 max-[900px]:grid-cols-2">
        <StatCard label="Active projects" value={active} />
        <StatCard label="Files uploaded" value={files} />
        <StatCard label="Open issues" value={openIssues} tone={openIssues ? "medium" : "default"} />
        <StatCard label="Reports ready" value={ready} />
      </div>
      <Card padded={false}>
        <div className="border-b border-line px-6 py-4">
          <h2 className="section-title">Projects</h2>
        </div>
        {isLoading ? <Spinner /> : error ? <div className="p-6"><ErrorText error={error} /></div> :
          <ProjectsTable projects={projects ?? []} onNew={() => setOpen(true)} />}
      </Card>
      {open && <NewProjectModal onClose={() => setOpen(false)} />}
    </div>
  );
}
