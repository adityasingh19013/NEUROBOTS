"""Load the sample_data/ files into the database as a ready-to-review demo project."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Project
from app.services import audit
from app.services.datasets import create_dataset
from app.services.metrics import seed_definitions
from app.services.pipeline import ensure_mapping, run_full

SAMPLE_FILES = ["1_beneficiaries_intake.xlsx", "2_attendance_records.csv", "3_survey_responses.csv"]


class SampleDataMissing(FileNotFoundError):
    pass


def create_sample_project(db: Session, user: str | None, process: bool = True) -> Project:
    folder = get_settings().sample_data_dir
    missing = [f for f in SAMPLE_FILES if not (folder / f).exists()]
    if missing:
        raise SampleDataMissing(f"Sample files not found in sample_data/: {', '.join(missing)}")
    p = Project(name="Digital Literacy 2026 – Q1", program="Digital Literacy 2026",
                description="Sahay Community Foundation (synthetic sample data with planted issues).",
                period_start=date(2026, 1, 1), period_end=date(2026, 3, 31), created_by=user)
    db.add(p)
    db.flush()
    seed_definitions(db, p)
    audit.log(db, p.id, "project", rule="project_created", user=user, note="Sample project from sample_data/")
    datasets = [create_dataset(db, p, (folder / f).read_bytes(), f, user) for f in SAMPLE_FILES]
    db.flush()
    if process:
        for ds in datasets:
            ensure_mapping(db, ds, user)
            ds.mapping_confirmed = True
        db.flush()
        run_full(db, p, user)
    db.commit()
    db.refresh(p)
    return p


def seed_if_empty(db: Session) -> None:
    if db.scalar(select(Project.id).limit(1)) is not None:
        return
    try:
        create_sample_project(db, get_settings().demo_user_email)
    except SampleDataMissing:
        db.rollback()
