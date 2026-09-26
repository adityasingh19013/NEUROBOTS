from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_project
from app.models import Dataset, Project, TransformLog, User
from app.schemas import UnmaskIn
from app.security import get_current_user
from app.services import audit
from app.services.privacy import PII_FIELDS, mask_value
from app.services.report import audit_csv

router = APIRouter(tags=["audit"])


def _query(p: Project, step: str | None, dataset_id: int | None, run_id: int | None, q: str | None):
    stmt = select(TransformLog).where(TransformLog.project_id == p.id)
    if step:
        stmt = stmt.where(TransformLog.step.in_(step.split(",")))
    if dataset_id:
        stmt = stmt.where(TransformLog.dataset_id == dataset_id)
    if run_id:
        stmt = stmt.where(TransformLog.run_id == run_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(TransformLog.rule.ilike(like) | TransformLog.note.ilike(like) | TransformLog.field.ilike(like))
    return stmt


def _entries(db: Session, p: Project, rows) -> list[dict]:
    files = dict(db.execute(select(Dataset.id, Dataset.filename).where(Dataset.project_id == p.id)).all())
    out = []
    for e in rows:
        d = audit.entry_dict(e, files.get(e.dataset_id))
        if e.field in PII_FIELDS:  # audit views never show full personal data
            d["value_before"] = mask_value(e.field, d["value_before"])
            d["value_after"] = mask_value(e.field, d["value_after"])
        out.append(d)
    return out


@router.get("/projects/{project_id}/audit-log")
def audit_log(step: str | None = None, dataset_id: int | None = None, run_id: int | None = None,
              q: str | None = None, limit: int = Query(200, le=5000), offset: int = 0,
              p: Project = Depends(get_project), db: Session = Depends(get_db)):
    stmt = _query(p, step, dataset_id, run_id, q)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(TransformLog.id.desc()).offset(offset).limit(limit))
    steps = [s for (s,) in db.execute(select(TransformLog.step).where(TransformLog.project_id == p.id).distinct())]
    return {"total": total, "steps": sorted(steps), "last_run_id": p.last_run_id, "entries": _entries(db, p, rows)}


@router.get("/projects/{project_id}/audit-log/export")
def audit_export(step: str | None = None, dataset_id: int | None = None, run_id: int | None = None,
                 q: str | None = None, p: Project = Depends(get_project), db: Session = Depends(get_db)):
    rows = db.scalars(_query(p, step, dataset_id, run_id, q).order_by(TransformLog.id))
    return Response(audit_csv(_entries(db, p, rows)), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="audit_log_project_{p.id}.csv"'})


@router.post("/projects/{project_id}/privacy/unmask")
def unmask(body: UnmaskIn, p: Project = Depends(get_project), db: Session = Depends(get_db),
           user: User = Depends(get_current_user)):
    """Record that a user switched on 'show personal data' (FR-7.5 / NFR privacy)."""
    audit.log(db, p.id, "privacy", rule="show_personal_data", user=user.email, note=body.reason)
    db.commit()
    return {"ok": True}
