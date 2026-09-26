import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import NewProjectModal from "@/components/NewProjectModal";
import ProjectsTable from "@/components/ProjectsTable";
import { Button, Card, ErrorText, PageHeader, Spinner } from "@/components/ui";

export default function Projects() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  return (
    <div className="mx-auto max-w-content px-8 py-8">
      <PageHeader
        title="Projects"
        subtitle="One project per report and reporting period."
        actions={<Button onClick={() => setOpen(true)}>+ New report</Button>}
      />
      <Card padded={false}>
        {isLoading ? <Spinner /> : error ? <div className="p-6"><ErrorText error={error} /></div> :
          <ProjectsTable projects={data ?? []} onNew={() => setOpen(true)} />}
      </Card>
      {open && <NewProjectModal onClose={() => setOpen(false)} />}
    </div>
  );
}
