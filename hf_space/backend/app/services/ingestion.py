"""Read xlsx/xls/csv into raw rows without changing anything (FR-1)."""
from __future__ import annotations

import hashlib
import io
import math
import os
import stat
from datetime import date, datetime
from pathlib import Path

import pandas as pd

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv"}
CSV_ENCODINGS = ["utf-8-sig", "utf-8", "cp1252", "latin-1"]


class IngestionError(ValueError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def store_raw_file(storage_dir: Path, data: bytes, filename: str) -> tuple[Path, str]:
    """Write the upload once and mark it read-only. Same content → same file."""
    digest = sha256_bytes(data)
    storage_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)
    path = storage_dir / f"{digest[:16]}_{safe}"
    if not path.exists():
        path.write_bytes(data)
        os.chmod(path, stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)
    return path, digest


def _json_safe(v):
    """Keep original values as close to the source as JSON allows."""
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v):
            return None
        return int(v) if v.is_integer() else v
    if isinstance(v, pd.Timestamp):
        v = v.to_pydatetime()
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, date):
        return v.isoformat()
    if hasattr(v, "item"):  # numpy scalar
        return _json_safe(v.item())
    if isinstance(v, str):
        return v
    return str(v)


def _is_blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def list_sheets(data: bytes, ext: str) -> list[str]:
    if ext == ".csv":
        return []
    engine = "openpyxl" if ext == ".xlsx" else "xlrd"
    with pd.ExcelFile(io.BytesIO(data), engine=engine) as xf:
        return list(xf.sheet_names)


def read_table(data: bytes, filename: str, sheet: str | None = None) -> dict:
    """Return {columns, rows: [(row_number, values)], sheet, sheets, encoding}.

    row_number is the spreadsheet row (header = row 1, first data row = 2).
    Blank lines are skipped but never renumber the rows after them.
    """
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise IngestionError(f"Unsupported file type '{ext}'. Use .xlsx, .xls or .csv.")

    encoding = None
    sheets: list[str] = []
    if ext == ".csv":
        df = None
        for enc in CSV_ENCODINGS:
            try:
                df = pd.read_csv(io.BytesIO(data), dtype=str, keep_default_na=False,
                                 skip_blank_lines=False, encoding=enc)
                encoding = enc
                break
            except UnicodeDecodeError:
                continue
            except pd.errors.EmptyDataError as e:
                raise IngestionError("The file is empty.") from e
        if df is None:
            raise IngestionError("Could not detect the text encoding of this CSV.")
    else:
        try:
            sheets = list_sheets(data, ext)
        except Exception as e:  # corrupt workbook
            raise IngestionError(f"Could not open workbook: {e}") from e
        if not sheets:
            raise IngestionError("Workbook has no sheets.")
        sheet = sheet if sheet in sheets else sheets[0]
        engine = "openpyxl" if ext == ".xlsx" else "xlrd"
        df = pd.read_excel(io.BytesIO(data), sheet_name=sheet, dtype=object, engine=engine)

    columns = [str(c).strip() for c in df.columns]
    if not columns or all(c.startswith("Unnamed") for c in columns):
        raise IngestionError("Could not find a header row (row 1 should contain column names).")
    if len(set(columns)) != len(columns):
        raise IngestionError("Duplicate column names in header row.")
    df.columns = columns

    rows = []
    for idx, record in enumerate(df.to_dict(orient="records")):
        values = {c: _json_safe(v) for c, v in record.items()}
        values = {c: (None if isinstance(v, str) and v == "" else v) for c, v in values.items()}
        if all(_is_blank(v) for v in values.values()):
            continue
        rows.append((idx + 2, values))

    return {"columns": columns, "rows": rows, "sheet": sheet if ext != ".csv" else None,
            "sheets": sheets, "encoding": encoding}


def guess_role(filename: str, columns: list[str]) -> str:
    text = (filename + " " + " ".join(columns)).lower()
    if any(k in text for k in ("attendance", "present", "session_date")):
        return "attendance"
    if any(k in text for k in ("survey", "feedback", "recommend", "confidence")):
        return "survey"
    if any(k in text for k in ("intake", "beneficiar", "registry", "enrol", "register")):
        return "beneficiary registry"
    return "other"
