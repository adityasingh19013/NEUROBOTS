"""Derived data. Everything here can be rebuilt from raw rows + user decisions + definitions."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.core import utcnow


class CleanRow(Base):
    """Standardised working copy of one raw row."""

    __tablename__ = "clean_rows"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    raw_row_id: Mapped[int] = mapped_column(ForeignKey("raw_rows.id"), index=True, unique=True)
    role: Mapped[str] = mapped_column(String(50))
    values: Mapped[dict] = mapped_column(JSON)
    # {"missing": [field], "problems": {field: issue_type}, "superseded": bool}
    flags: Mapped[dict] = mapped_column(JSON, default=dict)
    excluded: Mapped[bool] = mapped_column(Boolean, default=False)
    exclude_reason: Mapped[str | None] = mapped_column(String(255))
    person_id: Mapped[int | None] = mapped_column(Integer, index=True)
    # registry | linked | confirmed | review | unmatched
    link_status: Mapped[str | None] = mapped_column(String(20))
    link_score: Mapped[float | None] = mapped_column(Float)
    link_raw_row_id: Mapped[int | None] = mapped_column(Integer)


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    person_key: Mapped[str] = mapped_column(String(64), index=True)
    display_name_masked: Mapped[str] = mapped_column(String(255))
    anchor_raw_row_id: Mapped[int] = mapped_column(Integer)
    registry_raw_row_ids: Mapped[list] = mapped_column(JSON, default=list)


class MatchDecision(Base):
    """Candidate pair (duplicate person, or event-row → person link) and the human decision on it.

    Keyed by raw row ids so decisions survive re-processing.
    """

    __tablename__ = "match_decisions"
    __table_args__ = (UniqueConstraint("project_id", "kind", "raw_a", "raw_b"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # duplicate | link
    raw_a: Mapped[int] = mapped_column(Integer)
    raw_b: Mapped[int] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float)
    breakdown: Mapped[dict] = mapped_column(JSON, default=dict)
    band: Mapped[str] = mapped_column(String(20))  # suggested | review
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | merged | separate | linked | rejected
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    decided_by: Mapped[str | None] = mapped_column(String(255))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)


class Issue(Base):
    __tablename__ = "issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id"), index=True)
    raw_row_id: Mapped[int | None] = mapped_column(Integer, index=True)
    row_number: Mapped[int | None] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(50))
    severity: Mapped[str] = mapped_column(String(10))  # High | Medium | Low
    field: Mapped[str | None] = mapped_column(String(100))
    value: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | resolved | accepted
    note: Mapped[str | None] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(255), index=True)
    pair_id: Mapped[int | None] = mapped_column(Integer)
    updated_by: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TransformLog(Base):
    """Append-only audit trail (FR-8)."""

    __tablename__ = "transform_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    run_id: Mapped[int | None] = mapped_column(Integer, index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    user: Mapped[str | None] = mapped_column(String(255))
    step: Mapped[str] = mapped_column(String(30), index=True)
    rule: Mapped[str | None] = mapped_column(String(100))
    dataset_id: Mapped[int | None] = mapped_column(Integer, index=True)
    raw_row_id: Mapped[int | None] = mapped_column(Integer, index=True)
    row_number: Mapped[int | None] = mapped_column(Integer)
    field: Mapped[str | None] = mapped_column(String(100))
    value_before: Mapped[str | None] = mapped_column(Text)
    value_after: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
