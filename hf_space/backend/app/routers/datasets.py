from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import get_dataset, get_project
from app.models import ColumnMapping, Dataset, MappingTemplate, Project, RawRow, User
from app.schemas import DatasetPatch, MappingIn, SheetIn
from app.security import get_current_user
from app.services import audit
from app.services.datasets import active_count, create_dataset, read_stored
from app.services.ingestion import IngestionError, sha256_file
from app.services.mapping import CANONICAL_FIELDS, apply_template, column_signature, suggest_mapping
from app.services.privacy import PII_FIELDS, mask_raw_values, mask_value
from app.services.profiling import profile_columns

router = APIRouter(tags=["datasets"])
ROLES = ["beneficiary registry", "attendance", "survey", "other"]


def dataset_dict(d: Dataset) -> dict:
    return {
        "id": d.id, "project_id": d.project_id, "filename": d.filename, "sha256": d.sha256,
        "size_bytes": d.size_bytes, "role": d.role, "version": d.version, "sheet": d.sheet,
        "available_sheets": d.available_sheets or [], "encoding": d.encoding, "columns": d.columns,
        "row_count": d.row_count, "is_active": d.is_active, "mapping_confirmed": d.mapping_confirmed,
        "uploaded_by": d.uploaded_by, "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
    }


def _raw_rows(db: Session, ds: Dataset) -> list[RawRow]:
    return list(db.scalars(select(RawRow).where(RawRow.dataset_id == ds.id).order_by(RawRow.row_number)))


def _template(db: Session, ds: Dataset) -> MappingTemplate | None:
    return db.scalar(select(MappingTemplate).where(MappingTemplate.signature == column_signature(ds.columns)))


def _suggestions(db: Session, ds: Dataset) -> list[dict]:
    sugg = suggest_mapping(profile_columns(ds.columns, [r.original_values for r in _raw_rows(db, ds)]))
    t = _template(db, ds)
    return apply_template(sugg, t.mapping if t else None)


def _mask_samples(items: list[dict], reveal: bool) -> list[dict]:
    if reveal:
        return items
    for it in items:
        fld = it.get("canonical_field")
        if it.get("is_pii"):
            it["samples"] = [mask_value(fld if fld in PII_FIELDS else "full_name", s) for s in it["samples"]]
    return items


@router.get("/canonical-fields")
def canonical_fields(_: User = Depends(get_current_user)):
    return {"fields": [{"id": k, **v} for k, v in CANONICAL_FIELDS.items()], "roles": ROLES}


@router.post("/projects/{project_id}/datasets", status_code=201)
async def upload_datasets(files: list[UploadFile] = File(...), roles: list[str] | None = Form(None),
                          p: Project = Depends(get_project), db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """Upload one or many files in one request. Each file is validated on its own (bad files don't block good ones)."""
    s = get_settings()
    if active_count(db, p.id) + len(files) > s.max_files_per_project:
        raise HTTPException(422, f"A project can hold at most {s.max_files_per_project} files.")
    created, errors = [], []
    for i, f in enumerate(files):
        role = roles[i] if roles and i < len(roles) and roles[i] in ROLES else None
        data = await f.read()
        try:
            ds = create_dataset(db, p, data, f.filename or f"file_{i + 1}", user.email, role=role)
            db.commit()
            created.append(dataset_dict(ds))
        except IngestionError as e:
            db.rollback()
            errors.append({"filename": f.filename, "error": str(e)})
        except Exception as e:  # corrupt/unexpected file: report it, keep going
            db.rollback()
            errors.append({"filename": f.filename, "error": f"Could not read file: {e}"})
    return {"datasets": created, "errors": errors}


@router.get("/projects/{project_id}/datasets")
def list_datasets(include_inactive: bool = False, p: Project = Depends(get_project)):
    return [dataset_dict(d) for d in p.datasets if include_inactive or d.is_active]


@router.get("/datasets/{dataset_id}")
def get_dataset_detail(ds: Dataset = Depends(get_dataset)):
    return dataset_dict(ds)


@router.patch("/datasets/{dataset_id}")
def update_dataset(body: DatasetPatch, ds: Dataset = Depends(get_dataset), db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    audit.log(db, ds.project_id, "upload", rule="role_changed", user=user.email, dataset_id=ds.id,
              field="role", before=ds.role, after=body.role)
    ds.role = body.role
    db.commit()
    return dataset_dict(ds)


@router.post("/datasets/{dataset_id}/sheet", status_code=201)
def select_sheet(body: SheetIn, ds: Dataset = Depends(get_dataset), db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """Import a different sheet of the same workbook. Creates a new dataset version from the stored raw file."""
    if body.sheet not in (ds.available_sheets or []):
        raise HTTPException(422, f"Sheet '{body.sheet}' not found in {ds.filename}")
    p = db.get(Project, ds.project_id)
    try:
        new = create_dataset(db, p, read_stored(ds), ds.filename, user.email, role=ds.role, sheet=body.sheet)
    except IngestionError as e:
        raise HTTPException(422, str(e))
    ds.is_active = False
    db.commit()
    return dataset_dict(new)


@router.get("/datasets/{dataset_id}/rows")
def raw_rows(reveal: bool = False, limit: int = Query(200, le=10000), offset: int = 0,
             ds: Dataset = Depends(get_dataset), db: Session = Depends(get_db)):
    """Original values exactly as uploaded (PII masked unless reveal=true)."""
    pii = {m.source_column for m in ds.mappings if m.is_pii}
    fields = {m.source_column: m.canonical_field for m in ds.mappings}
    rows = _raw_rows(db, ds)
    out = []
    for r in rows[offset:offset + limit]:
        vals = r.original_values if reveal else mask_raw_values(r.original_values, pii, fields)
        out.append({"raw_row_id": r.id, "row_number": r.row_number, "sheet": r.sheet, "values": vals})
    return {"columns": ds.columns, "total": len(rows), "rows": out}


@router.get("/datasets/{dataset_id}/verify")
def verify(ds: Dataset = Depends(get_dataset)):
    try:
        current = sha256_file(ds.stored_path)
    except OSError:
        current = None
    return {"dataset_id": ds.id, "stored_sha256": ds.sha256, "current_sha256": current,
            "unchanged": current == ds.sha256}


@router.get("/datasets/{dataset_id}/profile")
def profile(ds: Dataset = Depends(get_dataset), db: Session = Depends(get_db)):
    return {"dataset_id": ds.id, "row_count": ds.row_count,
            "columns": profile_columns(ds.columns, [r.original_values for r in _raw_rows(db, ds)])}


@router.get("/datasets/{dataset_id}/mapping/suggest")
def mapping_suggest(reveal: bool = False, ds: Dataset = Depends(get_dataset), db: Session = Depends(get_db)):
    return {"dataset_id": ds.id, "columns": _mask_samples(_suggestions(db, ds), reveal)}


@router.get("/datasets/{dataset_id}/mapping")
def get_mapping(reveal: bool = False, ds: Dataset = Depends(get_dataset), db: Session = Depends(get_db)):
    """Saved mapping if confirmed, otherwise the suggestion – always with profile info for the UI."""
    sugg = {s["source_column"]: s for s in _suggestions(db, ds)}
    if ds.mappings:
        cols = []
        for m in ds.mappings:
            s = sugg.get(m.source_column, {})
            cols.append({**s, "source_column": m.source_column, "canonical_field": m.canonical_field,
                         "confidence": m.confidence, "reason": m.reason, "is_pii": m.is_pii})
    else:
        cols = list(sugg.values())
    return {"dataset_id": ds.id, "confirmed": ds.mapping_confirmed, "role": ds.role,
            "columns": _mask_samples(cols, reveal)}


@router.put("/datasets/{dataset_id}/mapping")
def save_mapping(body: MappingIn, ds: Dataset = Depends(get_dataset), db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    unknown = [c.source_column for c in body.columns if c.source_column not in ds.columns]
    if unknown:
        raise HTTPException(422, f"Unknown column(s): {', '.join(unknown)}")
    bad = [c.canonical_field for c in body.columns if c.canonical_field and c.canonical_field not in CANONICAL_FIELDS]
    if bad:
        raise HTTPException(422, f"Unknown field(s): {', '.join(bad)}")
    used = [c.canonical_field for c in body.columns if c.canonical_field]
    dupes = sorted({f for f in used if used.count(f) > 1})
    if dupes:
        raise HTTPException(422, f"Each field can be used once per file; repeated: {', '.join(dupes)}")

    sugg = {s["source_column"]: s for s in _suggestions(db, ds)}
    old = {m.source_column: m for m in ds.mappings}
    ds.mappings.clear()
    db.flush()
    by_col = {c.source_column: c for c in body.columns}
    for i, col in enumerate(ds.columns):
        c = by_col.get(col)
        fld = c.canonical_field if c else None
        s = sugg.get(col, {})
        conf = s.get("confidence", 0.0) if s.get("canonical_field") == fld else 1.0
        reason = s.get("reason") if s.get("canonical_field") == fld else "set by user"
        ds.mappings.append(ColumnMapping(position=i, source_column=col, canonical_field=fld,
                                         confidence=conf if fld else 0.0, reason=reason if fld else "ignored",
                                         is_pii=bool(c.is_pii) if c else False))
        before = old[col].canonical_field if col in old else s.get("canonical_field")
        if before != fld:
            audit.log(db, ds.project_id, "map", rule="mapping_changed", user=user.email, dataset_id=ds.id,
                      field=col, before=before, after=fld or "ignore")
    ds.mapping_confirmed = True
    audit.log(db, ds.project_id, "map", rule="mapping_confirmed", user=user.email, dataset_id=ds.id,
              note=", ".join(f"{m.source_column}→{m.canonical_field or 'ignore'}" for m in ds.mappings))
    if body.save_template:
        sig = column_signature(ds.columns)
        t = _template(db, ds) or MappingTemplate(signature=sig, columns=ds.columns)
        t.mapping = {m.source_column: {"field": m.canonical_field, "is_pii": m.is_pii} for m in ds.mappings}
        t.created_by = user.email
        db.add(t)
        audit.log(db, ds.project_id, "map", rule="template_saved", user=user.email, dataset_id=ds.id,
                  note="Mapping saved as template for files with the same columns")
    db.commit()
    return get_mapping(False, ds, db)
