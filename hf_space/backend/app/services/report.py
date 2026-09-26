"""Report assembly, drill-down trace, record lineage and exports (FR-7)."""
from __future__ import annotations

import csv
import io
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (CleanRow, Dataset, Issue, MatchDecision, MetricContribution, MetricDefinition,
                        MetricResult, Person, Project, RawRow, TransformLog)
from app.services.audit import entry_dict
from app.services.ingestion import sha256_file
from app.services.metrics import format_value
from app.services.privacy import PII_FIELDS, mask_clean_values, mask_raw_values, mask_value
from app.services.validate import ISSUE_TYPE_LABELS

TEMPLATES = Environment(loader=FileSystemLoader(Path(__file__).resolve().parent.parent / "templates"),
                        autoescape=select_autoescape(["html"]))

# ------------------------------------------------------------------ wording guard (FR-7.4)

BANNED_PHRASES = ["caused", "causes", "proved", "proves", "proven", "guarantees", "guaranteed",
                  "resulted in", "led to", "because of the program", "due to the program"]
_BANNED_RE = re.compile(r"\b(" + "|".join(re.escape(p) for p in BANNED_PHRASES) + r")\b", re.I)
# "not proven impact", "does not prove the program caused…" are honest caveats, not claims.
_NEGATION_RE = re.compile(r"\b(not|no|never|cannot|can't|doesn't|don't|without)\b(\W+\w+){0,4}\W*$", re.I)


def _is_negated(text: str, start: int) -> bool:
    return bool(_NEGATION_RE.search(text[max(0, start - 60):start]))


def banned_words(text: str | None) -> list[str]:
    text = text or ""
    return sorted({m.group(0).lower() for m in _BANNED_RE.finditer(text) if not _is_negated(text, m.start())})


def guard(text: str) -> str:
    """Neutralise causal wording in auto-generated text."""
    return _BANNED_RE.sub(lambda m: m.group(0) if _is_negated(text, m.start()) else "was recorded alongside", text)


# ------------------------------------------------------------------ helpers

def _datasets(db: Session, project_id: int) -> dict[int, Dataset]:
    return {d.id: d for d in db.scalars(select(Dataset).where(Dataset.project_id == project_id))}


def _pii_columns(ds: Dataset) -> tuple[set[str], dict[str, str | None]]:
    return ({m.source_column for m in ds.mappings if m.is_pii},
            {m.source_column: m.canonical_field for m in ds.mappings})


def _raw_view(raw: RawRow, ds: Dataset, reveal: bool) -> dict:
    if reveal:
        return raw.original_values
    pii, fields = _pii_columns(ds)
    return mask_raw_values(raw.original_values, pii, fields)


def _clean_view(values: dict, reveal: bool) -> dict:
    return values if reveal else mask_clean_values(values)


def latest_results(db: Session, project_id: int) -> dict[str, MetricResult]:
    return {r.metric_code: r for r in db.scalars(select(MetricResult).where(MetricResult.project_id == project_id))}


def definitions(db: Session, project_id: int) -> list[MetricDefinition]:
    return list(db.scalars(select(MetricDefinition).where(MetricDefinition.project_id == project_id)
                           .order_by(MetricDefinition.position, MetricDefinition.id)))


def metric_card(d: MetricDefinition, r: MetricResult | None) -> dict:
    return {
        "code": d.code, "name": d.name, "definition": d.definition, "unit": d.unit, "calc": d.calc,
        "source_roles": d.source_roles, "caveat": d.caveat,
        "result_id": r.id if r else None,
        "value": r.value if r else None,
        "display_value": format_value(r.value, d.unit) if r else "—",
        "included": r.included if r else 0,
        "excluded": r.excluded if r else 0,
        "excluded_reasons": r.excluded_reasons if r else {},
        "detail": r.detail if r else {},
        "computed_at": r.computed_at.isoformat() if r and r.computed_at else None,
    }


def issue_dict(i: Issue, ds: Dataset | None) -> dict:
    return {"id": i.id, "dataset_id": i.dataset_id, "file": ds.filename if ds else None,
            "sheet": ds.sheet if ds else None, "raw_row_id": i.raw_row_id, "row_number": i.row_number,
            "type": i.type, "type_label": ISSUE_TYPE_LABELS.get(i.type, i.type), "severity": i.severity,
            "field": i.field, "value": i.value, "message": i.message, "status": i.status, "note": i.note,
            "pair_id": i.pair_id, "updated_by": i.updated_by,
            "updated_at": i.updated_at.isoformat() if i.updated_at else None}


# ------------------------------------------------------------------ data quality

def data_quality(db: Session, project: Project) -> dict:
    dss = [d for d in _datasets(db, project.id).values() if d.is_active]
    issues = list(db.scalars(select(Issue).where(Issue.project_id == project.id)))
    by_ds = defaultdict(list)
    for i in issues:
        by_ds[i.dataset_id].append(i)
    merges = db.scalar(select(func.count()).select_from(MatchDecision).where(
        MatchDecision.project_id == project.id, MatchDecision.kind == "duplicate",
        MatchDecision.is_current, MatchDecision.status == "merged")) or 0
    pending_pairs = db.scalar(select(func.count()).select_from(MatchDecision).where(
        MatchDecision.project_id == project.id, MatchDecision.is_current,
        MatchDecision.status == "pending")) or 0

    files = []
    for d in dss:
        di = by_ds[d.id]
        high = sum(1 for i in di if i.severity == "High")
        score = max(0, round(100 - 100 * (high * 2 + (len(di) - high)) / max(1, d.row_count * 2)))
        files.append({
            "dataset_id": d.id, "file": d.filename, "sheet": d.sheet, "role": d.role, "rows": d.row_count,
            "issues": len(di), "open_issues": sum(1 for i in di if i.status == "open"),
            "quality_score": score, "sha256": d.sha256,
        })

    def count(*types):
        return sum(1 for i in issues if i.type in types)

    return {
        "rows_in": sum(d.row_count for d in dss),
        "files": files,
        "issues_total": len(issues),
        "issues_open": sum(1 for i in issues if i.status == "open"),
        "by_severity": dict(Counter(i.severity for i in issues)),
        "by_type": {t: n for t, n in Counter(i.type for i in issues).items()},
        "duplicates_merged": merges,
        "pending_decisions": pending_pairs,
        "exact_duplicates": count("exact_duplicate"),
        "missing_values": count("missing_required", "missing_value"),
        "invalid_values": count("out_of_range", "invalid_format", "unrecognised", "out_of_period"),
        "unmatched": count("unmatched"),
        "needs_review": count("link_review") + sum(1 for i in issues if i.type == "possible_duplicate"
                                                   and i.status == "open"),
    }


def assumptions(db: Session, project: Project) -> list[str]:
    run = project.last_run_id
    rules = Counter(r for (r,) in db.execute(select(TransformLog.rule).where(
        TransformLog.project_id == project.id, TransformLog.run_id == run, TransformLog.step == "standardise")))
    def n(count: int, one: str, many: str) -> str:
        return f"{count} {one if count == 1 else many}"

    out = []
    if rules["date_day_first_to_iso"]:
        out.append(f"{n(rules['date_day_first_to_iso'], 'ambiguous date was', 'ambiguous dates were')} read as "
                   "day-first (DD/MM/YYYY, e.g. 12/01/2026 = 12 January), the usual format in India.")
    if rules["date_month_first_to_iso"]:
        out.append(f"{n(rules['date_month_first_to_iso'], 'date', 'dates')} could only be month-first and "
                   "were read that way.")
    if rules["phone_10_digits"]:
        out.append(f"{n(rules['phone_10_digits'], 'phone number was', 'phone numbers were')} reduced to 10 digits "
                   "(country code +91 / leading 0 removed).")
    if rules["blank_gender_to_unknown"] or rules["gender_unrecognised_to_unknown"]:
        out.append("Blank or unrecognised gender values are reported as 'Unknown' (not guessed).")
    out += [
        f"Reporting period is {project.period_start.isoformat()} to {project.period_end.isoformat()}; "
        "records dated outside it are excluded from period metrics.",
        "Duplicate people are only merged after a human confirms the match; nothing is merged automatically.",
        "Attendance and survey rows are linked to an enrolled person only when the match score is 90 or more, "
        "or a reviewer confirmed a 70–89 match. Lower scores are reported as unmatched and never force-matched.",
        "When a person answered the survey more than once, their latest valid response is used.",
        "Missing values are never filled in; affected records are excluded from the metrics that need them.",
    ]
    return out


GLOBAL_CAVEATS = [
    "Figures describe what was recorded in the uploaded files. They are not a causal evaluation: there is no "
    "comparison group, so changes cannot be attributed to the program.",
    "Unresolved data issues are listed below and may affect the figures.",
]


def build_report(db: Session, project: Project) -> dict:
    results = latest_results(db, project.id)
    defs = definitions(db, project.id)
    dss = _datasets(db, project.id)
    open_issues = list(db.scalars(select(Issue).where(Issue.project_id == project.id, Issue.status == "open")
                                  .order_by(Issue.dataset_id, Issue.row_number)))
    integrity = []
    for d in dss.values():
        if not d.is_active:
            continue
        try:
            ok = sha256_file(d.stored_path) == d.sha256
        except OSError:
            ok = False
        integrity.append({"file": d.filename, "sha256": d.sha256, "verified": ok})

    cards = [metric_card(d, results.get(d.code)) for d in defs]
    summary = [guard(f"{c['display_value']} {c['name'].lower()} were recorded "
                     f"({c['included']} included, {c['excluded']} excluded).") for c in cards]
    return {
        "project": {"id": project.id, "name": project.name, "program": project.program,
                    "period_start": project.period_start.isoformat(), "period_end": project.period_end.isoformat()},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics_computed_at": project.metrics_computed_at.isoformat() if project.metrics_computed_at else None,
        "metrics": cards,
        "summary": summary,
        "data_quality": data_quality(db, project),
        "assumptions": assumptions(db, project),
        "unresolved_issues": [issue_dict(i, dss.get(i.dataset_id)) for i in open_issues],
        "caveats": GLOBAL_CAVEATS + [f"{c['code']} {c['name']}: {c['caveat']}" for c in cards if c["caveat"]],
        "integrity": integrity,
    }


# ------------------------------------------------------------------ trace (FR-7.2)

def trace(db: Session, result: MetricResult, reveal: bool = False) -> dict:
    project_id = result.project_id
    d = db.scalar(select(MetricDefinition).where(MetricDefinition.project_id == project_id,
                                                 MetricDefinition.code == result.metric_code))
    contribs = list(db.scalars(select(MetricContribution).where(MetricContribution.result_id == result.id)
                               .order_by(MetricContribution.raw_row_id)))
    dss = _datasets(db, project_id)
    raw_ids = {c.raw_row_id for c in contribs}
    persons = {p.id: p for p in db.scalars(select(Person).where(Person.project_id == project_id))}
    for p in persons.values():
        raw_ids |= set(p.registry_raw_row_ids)
    raws = {r.id: r for r in db.scalars(select(RawRow).where(RawRow.id.in_(raw_ids)))}
    cleans = {c.raw_row_id: c for c in db.scalars(select(CleanRow).where(CleanRow.raw_row_id.in_(raw_ids)))}

    def source(rid: int, note: str | None = None) -> dict:
        raw = raws[rid]
        ds = dss[raw.dataset_id]
        c = cleans.get(rid)
        return {"raw_row_id": rid, "file": ds.filename, "sheet": raw.sheet, "row": raw.row_number,
                "role": ds.role, "note": note, "link_score": c.link_score if c else None,
                "values": _clean_view(c.values, reveal) if c else {}}

    def name_of(p: Person) -> str:
        if reveal:
            c = cleans.get(p.anchor_raw_row_id)
            return (c.values.get("full_name") if c else None) or p.display_name_masked
        return p.display_name_masked

    included: dict[int, dict] = {}
    for c in contribs:
        if not c.included:
            continue
        p = persons.get(c.person_id)
        if p is None:
            continue
        if p.id not in included:
            reg = [source(rid, "registry" if i == 0 else "merged duplicate")
                   for i, rid in enumerate(p.registry_raw_row_ids)]
            included[p.id] = {"person_id": p.id, "person_key": p.person_key, "name": name_of(p),
                              "sources": reg, "contributing_rows": 0}
        included[p.id]["contributing_rows"] += 1
        if c.raw_row_id not in p.registry_raw_row_ids:
            included[p.id]["sources"].append(source(c.raw_row_id, "counted"))

    excluded = []
    for c in contribs:
        if c.included:
            continue
        s = source(c.raw_row_id)
        p = persons.get(c.person_id)
        s.update({"reason": c.reason, "person_key": p.person_key if p else None,
                  "name": name_of(p) if p else None})
        excluded.append(s)

    return {
        "result_id": result.id, "metric": f"{result.metric_code} {d.name if d else ''}".strip(),
        "code": result.metric_code, "value": result.value,
        "display_value": format_value(result.value, d.unit if d else ""),
        "definition": d.definition if d else None, "caveat": d.caveat if d else None,
        "detail": result.detail, "included_count": result.included, "excluded_count": result.excluded,
        "included": list(included.values()), "excluded": excluded, "masked": not reveal,
    }


# ------------------------------------------------------------------ lineage

def lineage(db: Session, raw: RawRow, reveal: bool = False) -> dict:
    ds = db.get(Dataset, raw.dataset_id)
    project = db.get(Project, ds.project_id)
    clean = db.scalar(select(CleanRow).where(CleanRow.raw_row_id == raw.id))
    logs = list(db.scalars(select(TransformLog).where(
        TransformLog.raw_row_id == raw.id,
        (TransformLog.run_id == project.last_run_id) | TransformLog.step.in_(["merge", "link_decision", "issue"]))
        .order_by(TransformLog.id)))
    issues = list(db.scalars(select(Issue).where(Issue.raw_row_id == raw.id)))
    person = db.get(Person, clean.person_id) if clean and clean.person_id else None
    entries = [entry_dict(e, ds.filename) for e in logs]
    if not reveal:
        for e in entries:
            if e["field"] in PII_FIELDS:
                e["value_before"] = mask_value(e["field"], e["value_before"])
                e["value_after"] = mask_value(e["field"], e["value_after"])
    return {
        "raw_row_id": raw.id, "file": ds.filename, "sheet": raw.sheet, "row": raw.row_number, "role": ds.role,
        "dataset_sha256": ds.sha256,
        "mapping": [{"source_column": m.source_column, "canonical_field": m.canonical_field, "is_pii": m.is_pii}
                    for m in ds.mappings],
        "original_values": _raw_view(raw, ds, reveal),
        "clean_values": _clean_view(clean.values, reveal) if clean else None,
        "excluded": clean.excluded if clean else None,
        "exclude_reason": clean.exclude_reason if clean else None,
        "link": {"status": clean.link_status, "score": clean.link_score,
                 "person_key": person.person_key if person else None,
                 "person_name": person.display_name_masked if person else None} if clean else None,
        "transformations": entries,
        "issues": [issue_dict(i, ds) for i in issues],
        "masked": not reveal,
    }


# ------------------------------------------------------------------ exports

def export_csv(db: Session, project: Project, reveal: bool) -> str:
    defs = {d.code: d for d in definitions(db, project.id)}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["metric_code", "metric_name", "metric_value", "definition", "person_key", "name",
                "included", "reason", "source_file", "sheet", "row"])
    for code, r in latest_results(db, project.id).items():
        t = trace(db, r, reveal=reveal)
        d = defs.get(code)
        base = [code, d.name if d else "", t["display_value"], d.definition if d else ""]
        for p in t["included"]:
            for s in p["sources"]:
                w.writerow(base + [p["person_key"], p["name"], "yes", s["note"], s["file"], s["sheet"] or "", s["row"]])
        for s in t["excluded"]:
            w.writerow(base + [s["person_key"] or "", s["name"] or "", "no", s["reason"], s["file"],
                               s["sheet"] or "", s["row"]])
    return buf.getvalue()


def render_html(db: Session, project: Project, reveal: bool) -> str:
    report = build_report(db, project)
    return TEMPLATES.get_template("report.html").render(r=report, masked=not reveal)


def export_pdf(db: Session, project: Project, reveal: bool) -> bytes:
    from xhtml2pdf import pisa

    html = render_html(db, project, reveal)
    out = io.BytesIO()
    status = pisa.CreatePDF(html, dest=out, encoding="utf-8")
    if status.err:
        raise RuntimeError("PDF rendering failed")
    return out.getvalue()


def audit_csv(entries: list[dict]) -> str:
    buf = io.StringIO()
    cols = ["timestamp", "user", "step", "rule", "run_id", "file", "row_number", "field", "value_before",
            "value_after", "note"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(entries)
    return buf.getvalue()
