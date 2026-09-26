import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { api } from "@/api/client";
import { Banner, Button, Modal } from "./ui";

export default function NewProjectModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [program, setProgram] = useState("");
  const [start, setStart] = useState("2026-01-01");
  const [end, setEnd] = useState("2026-03-31");

  const create = useMutation({
    mutationFn: () => api.createProject({ name, program: program || undefined, period_start: start, period_end: end }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${p.id}/upload`);
    },
  });
  const demo = useMutation({
    mutationFn: api.createDemo,
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${p.id}/upload`);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal
      title="New report"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-project" loading={create.isPending}>Create project</Button>
        </>
      }
    >
      <form id="new-project" onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="label">Project name</span>
          <input className="input mt-1.5" placeholder="e.g. Digital Literacy 2026 – Q2" value={name}
            onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label className="block">
          <span className="label">Program (optional)</span>
          <input className="input mt-1.5" placeholder="e.g. Digital Literacy" value={program} onChange={(e) => setProgram(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="label">Reporting period start</span>
            <input className="input mt-1.5" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="block">
            <span className="label">Reporting period end</span>
            <input className="input mt-1.5" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        {(create.error || demo.error) && <Banner tone="error">{(create.error || demo.error)!.message}</Banner>}
      </form>
      <div className="mt-6 flex items-center justify-between gap-4 rounded-ctl bg-hover px-4 py-3">
        <div className="text-[13px] text-muted">Trying ImpactTrace? Start with the three synthetic sample files.</div>
        <Button variant="outline" size="sm" icon={<Database className="h-4 w-4" />} loading={demo.isPending} onClick={() => demo.mutate()}>
          Use sample data
        </Button>
      </div>
    </Modal>
  );
}
