"""Orchestrates standardise → validate → dedupe → link → compute (POST /projects/{id}/process)."""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (CleanRow, ColumnMapping, Dataset, Issue, MappingTemplate, MatchDecision, Person, Project,
                        RawRow)
from app.services import audit, metrics
from app.services.dedupe import MatchRecord, candidate_pairs, exact_duplicate_key
from app.services.linking import Linker, group_registry
from app.services.mapping import apply_template, column_signature, suggest_mapping
from app.services.privacy import mask_name, person_key
from app.services.profiling import profile_columns
from app.services.standardise import normalise_name, standardise_row
from app.services.validate import SEVERITY, Finding, validate_row

LINK_ISSUE_TYPES = {"possible_duplicate", "unmatched", "link_review", "conflicting_records"}
EVENT_ROLES = {"attendance", "survey"}
ASSUMPTION_NOTES = {
    "day_first": "Ambiguous date read as day-first (DD/MM/YYYY)",
    "month_first_detected": "Second number > 12, so date read as month-first (MM/DD/YYYY)",
    "excel_serial": "Numeric Excel date serial converted",
}


def now() -> datetime:
    return datetime.now(timezone.utc)


def active_datasets(db: Session, project_id: int) -> list[Dataset]:
    return list(db.scalars(select(Dataset).where(Dataset.project_id == project_id, Dataset.is_active)
                           .order_by(Dataset.id)))


def ensure_mapping(db: Session, ds: Dataset, user: str | None) -> None:
    if ds.mappings:
        return
    rows = [r.original_values for r in db.scalars(select(RawRow).where(RawRow.dataset_id == ds.id))]
    template = db.scalar(select(MappingTemplate).where(MappingTemplate.signature == column_signature(ds.columns)))
    suggestions = apply_template(suggest_mapping(profile_columns(ds.columns, rows)), template.mapping if template else None)
    for i, s in enumerate(suggestions):
        ds.mappings.append(ColumnMapping(position=i, source_column=s["source_column"],
                                         canonical_field=s["canonical_field"], confidence=s["confidence"],
                                         reason=s["reason"], is_pii=s["is_pii"]))
    audit.log(db, ds.project_id, "map", rule="auto_suggestion_saved", user=user, dataset_id=ds.id,
              note="Suggested mapping saved automatically because processing started before confirmation")


def _issue(project_id: int, dataset_id: int, raw_row_id: int | None, row_number: int | None, f: Finding,
           prev: dict, pair_id: int | None = None, auto_status: tuple[str, str] | None = None) -> Issue:
    fp = f"{raw_row_id}:{f.type}:{f.field or ''}"
    status, note, by, at = prev.get(fp, ("open", None, None, None))
    if auto_status:
        status, note = auto_status
    return Issue(project_id=project_id, dataset_id=dataset_id, raw_row_id=raw_row_id, row_number=row_number,
                 type=f.type, severity=SEVERITY[f.type], field=f.field,
                 value=None if f.value is None else str(f.value), message=f.message, status=status, note=note,
                 fingerprint=fp, pair_id=pair_id, updated_by=by, updated_at=at)


def _prev_status(issues) -> dict:
    return {i.fingerprint: (i.status, i.note, i.updated_by, i.updated_at) for i in issues}


def run_full(db: Session, project: Project, user: str | None) -> dict:
    t0 = time.perf_counter()
    run_id = project.last_run_id + 1
    project.last_run_id = run_id
    datasets = active_datasets(db, project.id)
    ds_by_id = {d.id: d for d in datasets}

    prev = _prev_status(db.scalars(select(Issue).where(Issue.project_id == project.id)))
    db.execute(delete(Issue).where(Issue.project_id == project.id))
    db.execute(delete(Person).where(Person.project_id == project.id))
    db.execute(delete(CleanRow).where(CleanRow.project_id == project.id))
    audit.log(db, project.id, "standardise", rule="run_started", user=user, run_id=run_id,
              note=f"Processing {len(datasets)} active file(s); raw data untouched")

    errors: list[dict] = []
    for ds in datasets:
        ensure_mapping(db, ds, user)
        column_fields = {m.source_column: m.canonical_field for m in ds.mappings if m.canonical_field}
        mapped = set(column_fields.values())
        seen: dict[str, int] = {}
        for raw in db.scalars(select(RawRow).where(RawRow.dataset_id == ds.id).order_by(RawRow.row_number)):
            try:
                res = standardise_row(raw.original_values, column_fields)
                for fld, col, before, after, rule, assumption in res.changes:
                    audit.log(db, project.id, "standardise", rule=rule, user=user, run_id=run_id,
                              dataset_id=ds.id, raw_row_id=raw.id, row_number=raw.row_number, field=fld,
                              before=before, after=after,
                              note=ASSUMPTION_NOTES.get(assumption or "", f"column '{col}'"))
                findings = validate_row(ds.role, mapped, res.values, res.raw_by_field, res.missing,
                                        res.problems, project.period_start, project.period_end)
                cr = CleanRow(project_id=project.id, dataset_id=ds.id, raw_row_id=raw.id, role=ds.role,
                              values=res.values, flags={"missing": res.missing, "problems": res.problems})
                key = exact_duplicate_key(res.values)
                if key in seen:
                    cr.excluded = True
                    cr.exclude_reason = f"exact duplicate of row {seen[key]}"
                    findings.append(Finding("exact_duplicate", None, None,
                                            f"Identical to row {seen[key]} after standardisation; counted once."))
                    audit.log(db, project.id, "dedupe", rule="exact_duplicate_excluded", user=user, run_id=run_id,
                              dataset_id=ds.id, raw_row_id=raw.id, row_number=raw.row_number,
                              note=f"Same as row {seen[key]}")
                else:
                    seen[key] = raw.row_number
                db.add(cr)
                for f in findings:
                    db.add(_issue(project.id, ds.id, raw.id, raw.row_number, f, prev))
                    audit.log(db, project.id, "validate", rule=f.type, user=user, run_id=run_id,
                              dataset_id=ds.id, raw_row_id=raw.id, row_number=raw.row_number, field=f.field,
                              before=f.value, note=f.message)
            except Exception as e:  # never crash the whole run (NFR reliability)
                errors.append({"file": ds.filename, "row": raw.row_number, "error": str(e)})
                audit.log(db, project.id, "standardise", rule="row_failed", user=user, run_id=run_id,
                          dataset_id=ds.id, raw_row_id=raw.id, row_number=raw.row_number, note=str(e))
    db.flush()

    # ---- fuzzy duplicate candidates within the registry
    registry = list(db.scalars(select(CleanRow).where(CleanRow.project_id == project.id,
                                                      CleanRow.role == "beneficiary registry",
                                                      CleanRow.excluded.is_(False))
                               .order_by(CleanRow.raw_row_id)))
    records = [MatchRecord.from_values(c.raw_row_id, c.values) for c in registry]
    existing = {(d.raw_a, d.raw_b): d for d in db.scalars(
        select(MatchDecision).where(MatchDecision.project_id == project.id, MatchDecision.kind == "duplicate"))}
    for d in existing.values():
        d.is_current = False
    for a, b, score, breakdown in candidate_pairs(records):
        band = "suggested" if score >= 90 else "review"
        d = existing.get((a.raw_row_id, b.raw_row_id))
        if d is None:
            d = MatchDecision(project_id=project.id, kind="duplicate", raw_a=a.raw_row_id, raw_b=b.raw_row_id,
                              status="pending", score=score, breakdown=breakdown, band=band)
            db.add(d)
        d.score, d.breakdown, d.band, d.is_current = score, breakdown, band, True
        audit.log(db, project.id, "dedupe", rule=f"candidate_{band}", user=user, run_id=run_id,
                  raw_row_id=b.raw_row_id, note=f"Pair raw#{a.raw_row_id} ↔ raw#{b.raw_row_id}, score {score}")
    db.flush()

    rebuild_links(db, project, user, run_id=run_id, prev=prev)
    project.processed_at = now()
    metrics.compute_all(db, project, user)
    db.commit()
    return {"run_id": run_id, "files": len(datasets), "seconds": round(time.perf_counter() - t0, 2),
            "row_errors": errors}


def rebuild_links(db: Session, project: Project, user: str | None, run_id: int | None = None,
                  prev: dict | None = None) -> None:
    """(Re)build people from confirmed merges and link event rows. Safe to call after every decision."""
    run_id = run_id or project.last_run_id
    old_link_issues = list(db.scalars(select(Issue).where(Issue.project_id == project.id,
                                                          Issue.type.in_(LINK_ISSUE_TYPES))))
    if prev is None:
        prev = _prev_status(old_link_issues)
    for i in old_link_issues:
        db.delete(i)
    db.execute(delete(Person).where(Person.project_id == project.id))
    db.flush()

    rows = list(db.scalars(select(CleanRow).where(CleanRow.project_id == project.id).order_by(CleanRow.raw_row_id)))
    raw_info = {rid: (ds_id, rn) for rid, ds_id, rn in db.execute(
        select(RawRow.id, RawRow.dataset_id, RawRow.row_number)
        .join(Dataset, Dataset.id == RawRow.dataset_id).where(Dataset.project_id == project.id))}
    filenames = dict(db.execute(select(Dataset.id, Dataset.filename).where(Dataset.project_id == project.id)).all())

    def where(rid: int) -> str:
        ds_id, rn = raw_info[rid]
        return f"{filenames[ds_id]} row {rn}"

    registry = [c for c in rows if c.role == "beneficiary registry" and not c.excluded]
    records = {c.raw_row_id: MatchRecord.from_values(c.raw_row_id, c.values) for c in registry}
    dup_decisions = list(db.scalars(select(MatchDecision).where(
        MatchDecision.project_id == project.id, MatchDecision.kind == "duplicate", MatchDecision.is_current)))
    merged = [(d.raw_a, d.raw_b) for d in dup_decisions if d.status == "merged"]
    groups = group_registry(list(records), merged)

    # ---- people
    persons: list[Person] = []
    by_raw = {c.raw_row_id: c for c in registry}
    for g in groups:
        anchor = by_raw[g[0]]
        phone = next((by_raw[r].values.get("phone") for r in g if by_raw[r].values.get("phone")), None)
        p = Person(project_id=project.id, anchor_raw_row_id=g[0], registry_raw_row_ids=g,
                   person_key=person_key(phone, normalise_name(anchor.values.get("full_name")),
                                         normalise_name(anchor.values.get("location"))),
                   display_name_masked=mask_name(anchor.values.get("full_name")) or "(no name)")
        db.add(p)
        persons.append(p)
    db.flush()
    for gi, g in enumerate(groups):
        for rid in g:
            c = by_raw[rid]
            c.person_id, c.link_status, c.link_score, c.link_raw_row_id = persons[gi].id, "registry", None, None

    # ---- duplicate issues (auto-resolved once a human has decided)
    for d in dup_decisions:
        ds_id, rn = raw_info[d.raw_b]
        auto = None
        if d.status == "merged":
            auto = ("resolved", f"Merged by {d.decided_by or 'user'}")
        elif d.status == "separate":
            auto = ("resolved", f"Marked as different people by {d.decided_by or 'user'}")
        label = "Suggested merge" if d.band == "suggested" else "Needs review"
        f = Finding("possible_duplicate", None, None,
                    f"{label}: may be the same person as {where(d.raw_a)} (score {d.score:g}).")
        db.add(_issue(project.id, ds_id, d.raw_b, rn, f, prev, pair_id=d.id, auto_status=auto))

    # ---- link attendance / survey rows
    linker = Linker(groups, records)
    link_decisions = {(d.raw_a, d.raw_b): d for d in db.scalars(select(MatchDecision).where(
        MatchDecision.project_id == project.id, MatchDecision.kind == "link"))}
    for d in link_decisions.values():
        d.is_current = False

    for c in rows:
        if c.role not in EVENT_ROLES:
            continue
        c.person_id, c.link_status, c.link_score, c.link_raw_row_id = None, None, None, None
        if c.excluded:
            continue
        ds_id, rn = raw_info[c.raw_row_id]
        lr = linker.link(MatchRecord.from_values(c.raw_row_id, c.values))
        c.link_score, c.link_raw_row_id = lr.score, lr.registry_raw_row_id
        if lr.band == "linked":
            c.person_id, c.link_status = persons[lr.person_index].id, "linked"
        elif lr.band == "review":
            d = link_decisions.get((c.raw_row_id, lr.registry_raw_row_id))
            if d is None:
                d = MatchDecision(project_id=project.id, kind="link", raw_a=c.raw_row_id,
                                  raw_b=lr.registry_raw_row_id, status="pending", score=lr.score,
                                  breakdown=lr.breakdown, band="review")
                db.add(d)
                db.flush()
                link_decisions[(d.raw_a, d.raw_b)] = d
            d.score, d.breakdown, d.band, d.is_current = lr.score, lr.breakdown, "review", True
            if d.status == "linked":
                c.person_id, c.link_status = persons[lr.person_index].id, "confirmed"
            elif d.status == "rejected":
                c.link_status = "unmatched"
                db.add(_issue(project.id, ds_id, c.raw_row_id, rn, Finding(
                    "unmatched", None, None,
                    f"Reviewer rejected the suggested link to {where(lr.registry_raw_row_id)}; "
                    "not matched to any enrolled person."), prev))
            else:
                c.link_status = "review"
                db.add(_issue(project.id, ds_id, c.raw_row_id, rn, Finding(
                    "link_review", None, None,
                    f"Possible match to {where(lr.registry_raw_row_id)} (score {lr.score:g}); "
                    "needs a human decision before it is counted."), prev, pair_id=d.id))
        else:
            c.link_status = "unmatched"
            db.add(_issue(project.id, ds_id, c.raw_row_id, rn, Finding(
                "unmatched", None, None,
                "No enrolled person matches this record (best score "
                f"{lr.score:g}); it is not counted and was not force-matched."), prev))
        audit.log(db, project.id, "link", rule=f"link_{c.link_status}", user=user, run_id=run_id,
                  dataset_id=ds_id, raw_row_id=c.raw_row_id, row_number=rn,
                  after=None if lr.registry_raw_row_id is None else where(lr.registry_raw_row_id),
                  note=f"score {lr.score:g}")

    # ---- conflicting survey responses from the same person
    by_person: dict[int, list[CleanRow]] = defaultdict(list)
    for c in rows:
        if c.role == "survey":
            c.flags = {**(c.flags or {}), "superseded": False}
            if c.person_id and not c.excluded:
                by_person[c.person_id].append(c)
    for pid, rs in by_person.items():
        if len(rs) < 2:
            continue
        rs.sort(key=lambda c: (c.values.get("event_date") or "", raw_info[c.raw_row_id][1]))
        latest = rs[-1]
        for c in rs[:-1]:
            c.flags = {**c.flags, "superseded": True}
            keys = ("score_before", "score_after", "recommend")
            if any(c.values.get(k) != latest.values.get(k) for k in keys):
                ds_id, rn = raw_info[c.raw_row_id]
                db.add(_issue(project.id, ds_id, c.raw_row_id, rn, Finding(
                    "conflicting_records", None, None,
                    f"Same person answered again with different answers ({where(latest.raw_row_id)}); "
                    "the later response is used."), prev))
    db.flush()
