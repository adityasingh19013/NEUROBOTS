from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_project
from app.models import Issue, MatchDecision, MetricResult, Project, User
from app.routers.datasets import dataset_dict
from app.schemas import ProjectIn, ProjectPatch
from app.security import get_current_user
from app.services import audit
from app.services.metrics import seed_definitions
from app.services.seed import SampleDataMissing, create_sample_project

router = APIRouter(tags=["projects"])


def project_dict(db: Session, p: Project) -> dict:
    datasets = [d for d in p.datasets if d.is_active]
    open_issues = db.scalar(select(func.count()).select_from(Issue).where(
        Issue.project_id == p.id, Issue.status == "open")) or 0
    pending = db.scalar(select(func.count()).select_from(MatchDecision).where(
        MatchDecision.project_id == p.id, MatchDecision.is_current, MatchDecision.status == "pending")) or 0
    has_results = (db.scalar(select(func.count()).select_from(MetricResult).where(
        MetricResult.project_id == p.id)) or 0) > 0
    steps = {
        "upload": bool(datasets),
        "map": bool(datasets) and all(d.mapping_confirmed for d in datasets),
        "clean": p.processed_at is not None,
        "review": p.processed_at is not None and pending == 0,
        "metrics": has_results,
    }
    return {
        "id": p.id, "name": p.name, "description": p.description, "program": p.program,
        "period_start": p.period_start.isoformat(), "period_end": p.period_end.isoformat(),
        "created_by": p.created_by, "created_at": p.created_at.isoformat() if p.created_at else None,
        "processed_at": p.processed_at.isoformat() if p.processed_at else None,
        "metrics_computed_at": p.metrics_computed_at.isoformat() if p.metrics_computed_at else None,
        "file_count": len(datasets), "row_count": sum(d.row_count for d in datasets),
        "open_issues": open_issues, "pending_decisions": pending, "steps": steps,
        "datasets": [dataset_dict(d) for d in datasets],
    }


@router.get("/projects")
def list_projects(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return [project_dict(db, p) for p in db.scalars(select(Project).order_by(Project.id.desc()))]


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = Project(**body.model_dump(), created_by=user.email)
    db.add(p)
    db.flush()
    seed_definitions(db, p)
    audit.log(db, p.id, "project", rule="project_created", user=user.email,
              note=f"Period {p.period_start} – {p.period_end}")
    db.commit()
    db.refresh(p)
    return project_dict(db, p)


@router.post("/projects/demo", status_code=201)
def create_demo_project(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Create a project pre-loaded with the three synthetic sample files (uploaded, not yet mapped)."""
    try:
        p = create_sample_project(db, user.email, process=False)
    except SampleDataMissing as e:
        raise HTTPException(404, str(e))
    return project_dict(db, p)


@router.get("/projects/{project_id}")
def get_project_detail(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    return project_dict(db, p)


@router.patch("/projects/{project_id}")
def update_project(body: ProjectPatch, p: Project = Depends(get_project), db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        before = getattr(p, k)
        setattr(p, k, v)
        audit.log(db, p.id, "project", rule="project_updated", user=user.email, field=k, before=before, after=v)
    if p.period_end < p.period_start:
        raise HTTPException(422, "period_end must be on or after period_start")
    db.commit()
    return project_dict(db, p)
