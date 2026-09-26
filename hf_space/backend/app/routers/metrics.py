from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_project
from app.models import Dataset, MetricDefinition, MetricResult, Project, RawRow, User
from app.schemas import MetricsIn
from app.security import get_current_user
from app.services import audit, metrics, report

router = APIRouter(tags=["metrics"])


def _cards(db: Session, p: Project) -> list[dict]:
    results = report.latest_results(db, p.id)
    return [report.metric_card(d, results.get(d.code)) for d in report.definitions(db, p.id)]


@router.get("/projects/{project_id}/metrics")
def get_metrics(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    return {"metrics": _cards(db, p), "calc_types": sorted(metrics.CALC_TYPES)}


@router.put("/projects/{project_id}/metrics")
def put_metrics(body: MetricsIn, p: Project = Depends(get_project), db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    codes = [m.code for m in body.metrics]
    if len(set(codes)) != len(codes):
        raise HTTPException(422, "Metric codes must be unique")
    for m in body.metrics:
        words = report.banned_words(m.definition) + report.banned_words(m.name) + report.banned_words(m.caveat)
        if words:
            raise HTTPException(422, f"{m.code}: avoid causal claims the data cannot support "
                                     f"({', '.join(sorted(set(words)))}). Use neutral words like 'recorded' or 'reported'.")
        try:
            metrics.validate_calc(m.calc, set(codes))
        except metrics.MetricConfigError as e:
            raise HTTPException(422, f"{m.code}: {e}")

    existing = {d.code: d for d in db.scalars(select(MetricDefinition).where(MetricDefinition.project_id == p.id))}
    now = datetime.now(timezone.utc)
    calcs = {m.code: m.calc for m in body.metrics}
    for m in body.metrics:
        m.source_roles = metrics.roles_used(m.calc, calcs)
    for i, m in enumerate(body.metrics):
        d = existing.pop(m.code, None)
        if d is None:
            d = MetricDefinition(project_id=p.id, code=m.code)
            db.add(d)
            audit.log(db, p.id, "metric", rule="metric_added", user=user.email, field=m.code, after=m.name)
        else:
            for k in ("name", "definition", "unit", "caveat", "calc"):
                if getattr(d, k) != getattr(m, k):
                    audit.log(db, p.id, "metric", rule="metric_edited", user=user.email, field=f"{m.code}.{k}",
                              before=getattr(d, k), after=getattr(m, k))
        d.name, d.definition, d.unit, d.caveat, d.calc = m.name, m.definition, m.unit, m.caveat, m.calc
        d.source_roles, d.position, d.updated_by, d.updated_at = m.source_roles, i, user.email, now
    for d in existing.values():
        audit.log(db, p.id, "metric", rule="metric_removed", user=user.email, field=d.code, before=d.name)
        db.delete(d)
    db.flush()
    if p.processed_at:
        metrics.compute_all(db, p, user.email)
    db.commit()
    return {"metrics": _cards(db, p), "calc_types": sorted(metrics.CALC_TYPES)}


@router.post("/projects/{project_id}/metrics/compute")
def compute(p: Project = Depends(get_project), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not p.processed_at:
        raise HTTPException(422, "Process the data first (Clean & Review step).")
    metrics.compute_all(db, p, user.email)
    db.commit()
    return {"metrics": _cards(db, p)}


@router.get("/metric-results/{result_id}/trace")
def trace(result_id: int, reveal: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(MetricResult, result_id)
    if r is None:
        raise HTTPException(404, "Result not found – metrics may have been recomputed; reload the report.")
    if reveal:
        audit.log(db, r.project_id, "privacy", rule="unmask_trace", user=user.email, note=f"{r.metric_code}")
        db.commit()
    return report.trace(db, r, reveal=reveal)


@router.get("/records/{raw_row_id}/lineage")
def lineage(raw_row_id: int, reveal: bool = False, db: Session = Depends(get_db),
            user: User = Depends(get_current_user)):
    raw = db.get(RawRow, raw_row_id)
    if raw is None:
        raise HTTPException(404, "Record not found")
    out = report.lineage(db, raw, reveal=reveal)
    if reveal:
        ds = db.get(Dataset, raw.dataset_id)
        audit.log(db, ds.project_id, "privacy", rule="unmask_record", user=user.email, dataset_id=ds.id,
                  raw_row_id=raw.id, row_number=raw.row_number)
        db.commit()
    return out
