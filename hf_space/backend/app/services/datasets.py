"""Creating dataset versions from uploaded bytes (FR-1)."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Dataset, Project, RawRow
from app.services import audit
from app.services.ingestion import IngestionError, guess_role, read_table, store_raw_file


def create_dataset(db: Session, project: Project, data: bytes, filename: str, user: str | None,
                   role: str | None = None, sheet: str | None = None) -> Dataset:
    s = get_settings()
    if len(data) == 0:
        raise IngestionError("The file is empty.")
    if len(data) > s.max_file_mb * 1024 * 1024:
        raise IngestionError(f"File is larger than {s.max_file_mb} MB.")

    table = read_table(data, filename, sheet)
    if len(table["rows"]) > s.max_rows_per_file:
        raise IngestionError(f"File has more than {s.max_rows_per_file:,} rows.")
    path, digest = store_raw_file(s.storage_dir, data, filename)

    # A re-upload of the same file name (same sheet) becomes a new version; the old one is kept but inactive.
    previous = list(db.scalars(select(Dataset).where(Dataset.project_id == project.id,
                                                     Dataset.filename == filename, Dataset.is_active)))
    version = 1
    for p in previous:
        if p.sheet == table["sheet"] or sheet is None:
            p.is_active = False
            version = max(version, p.version + 1)
            role = role or p.role

    ds = Dataset(project_id=project.id, filename=filename, stored_path=str(path), sha256=digest,
                 size_bytes=len(data), role=role or guess_role(filename, table["columns"]), version=version,
                 sheet=table["sheet"], available_sheets=table["sheets"], encoding=table["encoding"],
                 columns=table["columns"], row_count=len(table["rows"]), uploaded_by=user)
    db.add(ds)
    db.flush()
    db.add_all(RawRow(dataset_id=ds.id, sheet=table["sheet"], row_number=rn, original_values=vals)
               for rn, vals in table["rows"])
    audit.log(db, project.id, "upload", rule="raw_file_stored", user=user, dataset_id=ds.id,
              after=digest,
              note=f"{filename}{' / ' + table['sheet'] if table['sheet'] else ''}: {len(table['rows'])} rows, "
                   f"version {version}, stored read-only (SHA-256)")
    return ds


def active_count(db: Session, project_id: int) -> int:
    return len(list(db.scalars(select(Dataset.id).where(Dataset.project_id == project_id, Dataset.is_active))))


def read_stored(ds: Dataset) -> bytes:
    return Path(ds.stored_path).read_bytes()
