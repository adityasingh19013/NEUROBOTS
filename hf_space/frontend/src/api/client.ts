import type {
  AuditEntry, CanonicalField, DataQuality, Dataset, Issue, IssueStatus, Lineage, Mapping, MetricCard, Pair,
  Project, Report, Role, Trace, User,
} from "@/types";

const BASE = "/api/v1";
const TOKEN_KEY = "impacttrace.token";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable – session only */
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

function detail(body: any, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) return body.detail.map((d: any) => d.msg?.replace(/^Value error, /, "")).join("; ");
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, detail(body, `Request failed (${res.status})`));
  }
  const type = res.headers.get("content-type") || "";
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

async function download(path: string, fallbackName: string) {
  const token = getToken();
  const res = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, detail(body, "Download failed"));
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName;
  saveBlob(blob, name);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  });
  const str = s.toString();
  return str ? `?${str}` : "";
};

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<{ access_token: string; user: User }>("/auth/login", { method: "POST", body: json({ email, password }) }),
  register: (name: string, email: string, password: string) =>
    request<{ access_token: string; user: User }>("/auth/register", {
      method: "POST", body: json({ name, email, password }),
    }),
  me: () => request<User>("/auth/me"),

  // projects
  projects: () => request<Project[]>("/projects"),
  project: (id: number) => request<Project>(`/projects/${id}`),
  createProject: (body: { name: string; program?: string; period_start: string; period_end: string; description?: string }) =>
    request<Project>("/projects", { method: "POST", body: json(body) }),
  createDemo: () => request<Project>("/projects/demo", { method: "POST" }),
  updateProject: (id: number, body: Partial<Pick<Project, "name" | "program" | "period_start" | "period_end">>) =>
    request<Project>(`/projects/${id}`, { method: "PATCH", body: json(body) }),

  // datasets
  canonicalFields: () => request<{ fields: CanonicalField[]; roles: Role[] }>("/canonical-fields"),
  upload: (projectId: number, files: File[], roles: Role[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    roles.forEach((r) => fd.append("roles", r));
    return request<{ datasets: Dataset[]; errors: { filename: string; error: string }[] }>(
      `/projects/${projectId}/datasets`, { method: "POST", body: fd });
  },
  setRole: (datasetId: number, role: Role) =>
    request<Dataset>(`/datasets/${datasetId}`, { method: "PATCH", body: json({ role }) }),
  selectSheet: (datasetId: number, sheet: string) =>
    request<Dataset>(`/datasets/${datasetId}/sheet`, { method: "POST", body: json({ sheet }) }),
  mapping: (datasetId: number, reveal = false) => request<Mapping>(`/datasets/${datasetId}/mapping${q({ reveal })}`),
  saveMapping: (datasetId: number, columns: { source_column: string; canonical_field: string | null; is_pii: boolean }[],
    saveTemplate = false) =>
    request<Mapping>(`/datasets/${datasetId}/mapping`, {
      method: "PUT", body: json({ columns, save_template: saveTemplate }),
    }),
  verify: (datasetId: number) =>
    request<{ unchanged: boolean; stored_sha256: string; current_sha256: string | null }>(`/datasets/${datasetId}/verify`),

  // processing
  process: (projectId: number) =>
    request<{ run_id: number; seconds: number; row_errors: any[]; data_quality: DataQuality }>(
      `/projects/${projectId}/process`, { method: "POST" }),
  dataQuality: (projectId: number) => request<DataQuality>(`/projects/${projectId}/data-quality`),
  issues: (projectId: number, f: { type?: string; severity?: string; status?: string; dataset_id?: number } = {}) =>
    request<{ total: number; types: Record<string, string>; issues: Issue[] }>(`/projects/${projectId}/issues${q(f)}`),
  updateIssue: (issueId: number, status: IssueStatus, note?: string) =>
    request<Issue>(`/issues/${issueId}`, { method: "PATCH", body: json({ status, note }) }),
  pairs: (projectId: number, reveal = false) =>
    request<{ pairs: Pair[]; pending: number }>(`/projects/${projectId}/duplicates${q({ reveal })}`),
  decide: (pairId: number, decision: "merge" | "separate" | "link" | "reject" | "undo", note?: string) =>
    request<{ pair: Pair; data_quality: DataQuality }>(`/duplicates/${pairId}/decision`, {
      method: "POST", body: json({ decision, note }),
    }),

  // metrics & report
  metrics: (projectId: number) => request<{ metrics: MetricCard[]; calc_types: string[] }>(`/projects/${projectId}/metrics`),
  saveMetrics: (projectId: number, metrics: Pick<MetricCard, "code" | "name" | "definition" | "unit" | "source_roles" | "calc" | "caveat">[]) =>
    request<{ metrics: MetricCard[] }>(`/projects/${projectId}/metrics`, { method: "PUT", body: json({ metrics }) }),
  compute: (projectId: number) =>
    request<{ metrics: MetricCard[] }>(`/projects/${projectId}/metrics/compute`, { method: "POST" }),
  trace: (resultId: number, reveal = false) => request<Trace>(`/metric-results/${resultId}/trace${q({ reveal })}`),
  lineage: (rawRowId: number, reveal = false) => request<Lineage>(`/records/${rawRowId}/lineage${q({ reveal })}`),
  report: (projectId: number) => request<Report>(`/projects/${projectId}/report`),
  exportReport: (projectId: number, format: "pdf" | "csv", masked: boolean) =>
    download(`/projects/${projectId}/report/export${q({ format, masked })}`, `report.${format}`),

  // audit & privacy
  audit: (projectId: number, f: { step?: string; dataset_id?: number; run_id?: number; q?: string; limit?: number; offset?: number } = {}) =>
    request<{ total: number; steps: string[]; last_run_id: number; entries: AuditEntry[] }>(
      `/projects/${projectId}/audit-log${q(f)}`),
  exportAudit: (projectId: number, f: { step?: string; dataset_id?: number; q?: string } = {}) =>
    download(`/projects/${projectId}/audit-log/export${q(f)}`, "audit_log.csv"),
  unmask: (projectId: number, reason?: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/privacy/unmask`, { method: "POST", body: json({ reason }) }),
};
