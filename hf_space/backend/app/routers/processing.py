from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_project
from app.models import CleanRow, Dataset, Issue, MatchDecision, Project, RawRow, User
from app.schemas import DecisionIn, IssuePatch
from app.security import get_current_user
from app.services import audit, metrics
from app.services.pipeline import active_datasets, rebuild_links, run_full
from app.services.privacy import mask_clean_values
from app.services.report import data_quality, issue_dict
from app.services.validate import ISSUE_TYPE_LABELS

router = APIRouter(tags=["processing"])
SEVERITY_ORDER = {"High": 0, "Medium": 1, "Low": 2}


@router.post("/projects/{project_id}/process")
def process(p: Project = Depends(get_project), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Standardise → validate → dedupe → link → compute. Raw rows are read, never written."""
    if not active_datasets(db, p.id):
        raise HTTPException(422, "Upload at least one file first.")
    summary = run_full(db, p, user.email)
    return {**summary, "data_quality": data_quality(db, p)}


@router.get("/projects/{project_id}/data-quality")
def get_data_quality(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    return data_quality(db, p)


@router.get("/projects/{project_id}/issues")
def list_issues(type: str | None = None, severity: str | None = None, status: str | None = None,
                dataset_id: int | None = None, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    q = select(Issue).where(Issue.project_id == p.id)
    if type:
        q = q.where(Issue.type.in_(type.split(",")))
    if severity:
        q = q.where(Issue.severity.in_(severity.split(",")))
    if status:
        q = q.where(Issue.status.in_(status.split(",")))
    if dataset_id:
        q = q.where(Issue.dataset_id == dataset_id)
    dss = {d.id: d for d in db.scalars(select(Dataset).where(Dataset.project_id == p.id))}
    items = sorted(db.scalars(q), key=lambda i: (SEVERITY_ORDER.get(i.severity, 9), i.dataset_id, i.row_number or 0))
    return {"total": len(items), "types": ISSUE_TYPE_LABELS, "issues": [issue_dict(i, dss.get(i.dataset_id)) for i in items]}


@router.patch("/issues/{issue_id}")
def update_issue(issue_id: int, body: IssuePatch, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    i = db.get(Issue, issue_id)
    if i is None:
        raise HTTPException(404, "Issue not found")
    audit.log(db, i.project_id, "issue", rule=f"issue_{body.status}", user=user.email, dataset_id=i.dataset_id,
              raw_row_id=i.raw_row_id, row_number=i.row_number, field=i.field, before=i.status, after=body.status,
              note=body.note)
    i.status, i.note = body.status, body.note
    i.updated_by, i.updated_at = user.email, datetime.now(timezone.utc)
    db.commit()
    return issue_dict(i, db.get(Dataset, i.dataset_id))


def _record(db: Session, raw_id: int, reveal: bool) -> dict:
    raw = db.get(RawRow, raw_id)
    ds = db.get(Dataset, raw.dataset_id)
    c = db.scalar(select(CleanRow).where(CleanRow.raw_row_id == raw_id))
    vals = c.values if c else {}
    return {"raw_row_id": raw_id, "file": ds.filename, "sheet": raw.sheet, "row": raw.row_number, "role": ds.role,
            "values": vals if reveal else mask_clean_values(vals)}


def pair_dict(db: Session, d: MatchDecision, reveal: bool) -> dict:
    a, b = _record(db, d.raw_a, reveal), _record(db, d.raw_b, reveal)
    keys = [k for k in ("external_id", "full_name", "phone", "gender", "age", "location", "event_date", "program")
            if k in a["values"] or k in b["values"]]
    differing = [k for k in keys if a["values"].get(k) != b["values"].get(k)]
    return {"id": d.id, "kind": d.kind, "score": d.score, "band": d.band, "breakdown": d.breakdown,
            "status": d.status, "decided_by": d.decided_by,
            "decided_at": d.decided_at.isoformat() if d.decided_at else None, "note": d.note,
            "record_a": a, "record_b": b, "fields": keys, "differing_fields": differing}


@router.get("/projects/{project_id}/duplicates")
def list_duplicates(kind: str | None = None, reveal: bool = False, p: Project = Depends(get_project),
                    db: Session = Depends(get_db)):
    q = select(MatchDecision).where(MatchDecision.project_id == p.id, MatchDecision.is_current)
    if kind:
        q = q.where(MatchDecision.kind == kind)
    pairs = sorted(db.scalars(q), key=lambda d: (d.status != "pending", d.kind, -d.score, d.id))
    return {"pairs": [pair_dict(db, d, reveal) for d in pairs],
            "pending": sum(1 for d in pairs if d.status == "pending")}


VALID = {"duplicate": {"merge": "merged", "separate": "separate", "undo": "pending"},
         "link": {"link": "linked", "reject": "rejected", "undo": "pending"}}


@router.post("/duplicates/{pair_id}/decision")
def decide(pair_id: int, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = db.get(MatchDecision, pair_id)
    if d is None:
        raise HTTPException(404, "Pair not found")
    status = VALID[d.kind].get(body.decision)
    if status is None:
        raise HTTPException(422, f"'{body.decision}' is not valid for a {d.kind} pair")
    p = db.get(Project, d.project_id)
    raw_b = db.get(RawRow, d.raw_b)
    audit.log(db, p.id, "merge" if d.kind == "duplicate" else "link_decision",
              rule=f"{d.kind}_{body.decision}", user=user.email, dataset_id=raw_b.dataset_id if raw_b else None,
              raw_row_id=d.raw_b, row_number=raw_b.row_number if raw_b else None,
              before=d.status, after=status, note=body.note or f"score {d.score:g}; pair raw#{d.raw_a} ↔ raw#{d.raw_b}")
    if d.kind == "link":
        raw_a = db.get(RawRow, d.raw_a)
        audit.log(db, p.id, "link_decision", rule=f"link_{body.decision}", user=user.email,
                  dataset_id=raw_a.dataset_id, raw_row_id=d.raw_a, row_number=raw_a.row_number,
                  before=d.status, after=status, note=body.note)
    d.status = status
    d.decided_by = None if status == "pending" else user.email
    d.decided_at = None if status == "pending" else datetime.now(timezone.utc)
    d.note = body.note
    db.flush()
    rebuild_links(db, p, user.email)
    metrics.compute_all(db, p, user.email)
    db.commit()
    return {"pair": pair_dict(db, d, False), "data_quality": data_quality(db, p)}
