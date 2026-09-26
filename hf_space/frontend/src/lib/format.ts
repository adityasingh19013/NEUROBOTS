const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtPeriod(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  }
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return fmtDate(iso);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(blank)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export const FIELD_LABELS: Record<string, string> = {
  external_id: "ID",
  full_name: "Full name",
  phone: "Phone",
  gender: "Gender",
  age: "Age",
  location: "Village",
  event_date: "Date",
  program: "Program",
  session_topic: "Session topic",
  attended: "Attended",
  score_before: "Score before",
  score_after: "Score after",
  recommend: "Would recommend",
};

export const ROLE_LABELS: Record<string, string> = {
  "beneficiary registry": "Beneficiary registry",
  attendance: "Attendance",
  survey: "Survey",
  other: "Other",
};

export const STEP_LABELS: Record<string, string> = {
  project: "Project",
  upload: "Upload",
  map: "Map",
  standardise: "Standardise",
  validate: "Validate",
  dedupe: "Deduplicate",
  merge: "Merge",
  link: "Link",
  link_decision: "Link decision",
  issue: "Issue",
  metric: "Metric",
  compute: "Calculate",
  export: "Export",
  privacy: "Privacy",
};

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
