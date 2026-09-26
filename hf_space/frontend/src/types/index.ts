export type Role = "beneficiary registry" | "attendance" | "survey" | "other";
export type Severity = "High" | "Medium" | "Low";
export type IssueStatus = "open" | "resolved" | "accepted";

export interface User {
  id: number;
  email: string;
  name: string;
}

export interface Dataset {
  id: number;
  project_id: number;
  filename: string;
  sha256: string;
  size_bytes: number;
  role: Role;
  version: number;
  sheet: string | null;
  available_sheets: string[];
  encoding: string | null;
  columns: string[];
  row_count: number;
  is_active: boolean;
  mapping_confirmed: boolean;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  program: string | null;
  period_start: string;
  period_end: string;
  created_by: string | null;
  created_at: string | null;
  processed_at: string | null;
  metrics_computed_at: string | null;
  file_count: number;
  row_count: number;
  open_issues: number;
  pending_decisions: number;
  steps: { upload: boolean; map: boolean; clean: boolean; review: boolean; metrics: boolean };
  datasets: Dataset[];
}

export interface CanonicalField {
  id: string;
  label: string;
  type: string;
  pii?: boolean;
}

export interface MappingColumn {
  source_column: string;
  canonical_field: string | null;
  confidence: number;
  reason: string | null;
  is_pii: boolean;
  detected_type?: string;
  samples?: unknown[];
  blank_pct?: number;
  distinct_count?: number;
}

export interface Mapping {
  dataset_id: number;
  confirmed: boolean;
  role: Role;
  columns: MappingColumn[];
}

export interface Issue {
  id: number;
  dataset_id: number;
  file: string | null;
  sheet: string | null;
  raw_row_id: number | null;
  row_number: number | null;
  type: string;
  type_label: string;
  severity: Severity;
  field: string | null;
  value: string | null;
  message: string;
  status: IssueStatus;
  note: string | null;
  pair_id: number | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface FileQuality {
  dataset_id: number;
  file: string;
  sheet: string | null;
  role: Role;
  rows: number;
  issues: number;
  open_issues: number;
  quality_score: number;
  sha256: string;
}

export interface DataQuality {
  rows_in: number;
  files: FileQuality[];
  issues_total: number;
  issues_open: number;
  by_severity: Record<string, number>;
  by_type: Record<string, number>;
  duplicates_merged: number;
  pending_decisions: number;
  exact_duplicates: number;
  missing_values: number;
  invalid_values: number;
  unmatched: number;
  needs_review: number;
}

export interface PairRecord {
  raw_row_id: number;
  file: string;
  sheet: string | null;
  row: number;
  role: Role;
  values: Record<string, unknown>;
}

export interface Pair {
  id: number;
  kind: "duplicate" | "link";
  score: number;
  band: "suggested" | "review";
  breakdown: {
    phone_match: number;
    name_similarity: number;
    name_points: number;
    name_only_match?: number;
    phone_missing?: boolean;
    location_match: number;
    phone_conflict: number;
    total: number;
  };
  status: "pending" | "merged" | "separate" | "linked" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  record_a: PairRecord;
  record_b: PairRecord;
  fields: string[];
  differing_fields: string[];
}

export interface MetricCard {
  code: string;
  name: string;
  definition: string;
  unit: string;
  calc: Record<string, any>;
  source_roles: string[];
  caveat: string | null;
  result_id: number | null;
  value: number | null;
  display_value: string;
  included: number;
  excluded: number;
  excluded_reasons: Record<string, number>;
  detail: Record<string, any>;
  computed_at: string | null;
}

export interface TraceSource {
  raw_row_id: number;
  file: string;
  sheet: string | null;
  row: number;
  role: Role;
  note: string | null;
  link_score: number | null;
  values: Record<string, unknown>;
  reason?: string;
  person_key?: string | null;
  name?: string | null;
}

export interface TracePerson {
  person_id: number;
  person_key: string;
  name: string;
  sources: TraceSource[];
  contributing_rows: number;
}

export interface Trace {
  result_id: number;
  metric: string;
  code: string;
  value: number | null;
  display_value: string;
  definition: string | null;
  caveat: string | null;
  detail: Record<string, any>;
  included_count: number;
  excluded_count: number;
  included: TracePerson[];
  excluded: TraceSource[];
  masked: boolean;
}

export interface AuditEntry {
  id: number;
  timestamp: string | null;
  user: string | null;
  step: string;
  rule: string | null;
  run_id: number | null;
  dataset_id: number | null;
  file: string | null;
  raw_row_id: number | null;
  row_number: number | null;
  field: string | null;
  value_before: string | null;
  value_after: string | null;
  note: string | null;
}

export interface Lineage {
  raw_row_id: number;
  file: string;
  sheet: string | null;
  row: number;
  role: Role;
  dataset_sha256: string;
  mapping: { source_column: string; canonical_field: string | null; is_pii: boolean }[];
  original_values: Record<string, unknown>;
  clean_values: Record<string, unknown> | null;
  excluded: boolean | null;
  exclude_reason: string | null;
  link: { status: string | null; score: number | null; person_key: string | null; person_name: string | null } | null;
  transformations: AuditEntry[];
  issues: Issue[];
  masked: boolean;
}

export interface Report {
  project: { id: number; name: string; program: string | null; period_start: string; period_end: string };
  generated_at: string;
  metrics_computed_at: string | null;
  metrics: MetricCard[];
  summary: string[];
  data_quality: DataQuality;
  assumptions: string[];
  unresolved_issues: Issue[];
  caveats: string[];
  integrity: { file: string; sha256: string; verified: boolean }[];
}
