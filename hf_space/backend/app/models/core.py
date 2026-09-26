from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    program: Mapped[str | None] = mapped_column(String(255))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    created_by: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_run_id: Mapped[int] = mapped_column(Integer, default=0)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metrics_computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    datasets: Mapped[list["Dataset"]] = relationship(back_populates="project", order_by="Dataset.id")


class Dataset(Base):
    """One uploaded file (one sheet). Re-uploading creates a new version; old versions stay stored."""

    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(1024))
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(50), default="other")
    version: Mapped[int] = mapped_column(Integer, default=1)
    sheet: Mapped[str | None] = mapped_column(String(255))
    available_sheets: Mapped[list] = mapped_column(JSON, default=list)
    encoding: Mapped[str | None] = mapped_column(String(50))
    columns: Mapped[list] = mapped_column(JSON, default=list)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    mapping_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(255))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="datasets")
    mappings: Mapped[list["ColumnMapping"]] = relationship(
        back_populates="dataset", order_by="ColumnMapping.position", cascade="all, delete-orphan"
    )


class RawRow(Base):
    """An original row exactly as read from the file. No update/delete path exists (DB triggers enforce it)."""

    __tablename__ = "raw_rows"
    __table_args__ = (UniqueConstraint("dataset_id", "row_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    sheet: Mapped[str | None] = mapped_column(String(255))
    row_number: Mapped[int] = mapped_column(Integer)
    original_values: Mapped[dict] = mapped_column(JSON)


class MappingTemplate(Base):
    """Confirmed mapping saved for reuse when a file with the same set of columns is uploaded again (FR-2.5)."""

    __tablename__ = "mapping_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    signature: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    columns: Mapped[list] = mapped_column(JSON)
    mapping: Mapped[dict] = mapped_column(JSON)  # source column -> {"field": str|None, "is_pii": bool}
    created_by: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ColumnMapping(Base):
    __tablename__ = "column_mappings"

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    source_column: Mapped[str] = mapped_column(String(255))
    canonical_field: Mapped[str | None] = mapped_column(String(100))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str | None] = mapped_column(String(255))
    is_pii: Mapped[bool] = mapped_column(Boolean, default=False)

    dataset: Mapped[Dataset] = relationship(back_populates="mappings")
