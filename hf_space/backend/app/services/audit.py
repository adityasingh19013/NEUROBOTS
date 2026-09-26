"""Append-only transformation/audit log (FR-8)."""
from sqlalchemy.orm import Session

from app.models import TransformLog


def _s(v) -> str | None:
    if v is None:
        return None
    return str(v)


def log(db: Session, project_id: int, step: str, *, rule: str | None = None, user: str | None = None,
        run_id: int | None = None, dataset_id: int | None = None, raw_row_id: int | None = None,
        row_number: int | None = None, field: str | None = None, before=None, after=None,
        note: str | None = None) -> None:
    db.add(TransformLog(
        project_id=project_id, run_id=run_id, user=user, step=step, rule=rule, dataset_id=dataset_id,
        raw_row_id=raw_row_id, row_number=row_number, field=field,
        value_before=_s(before), value_after=_s(after), note=note,
    ))


def entry_dict(e: TransformLog, filename: str | None = None) -> dict:
    return {
        "id": e.id, "timestamp": e.ts.isoformat() if e.ts else None, "user": e.user, "step": e.step,
        "rule": e.rule, "run_id": e.run_id, "dataset_id": e.dataset_id, "file": filename,
        "raw_row_id": e.raw_row_id, "row_number": e.row_number, "field": e.field,
        "value_before": e.value_before, "value_after": e.value_after, "note": e.note,
    }
