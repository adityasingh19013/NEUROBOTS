"""Request bodies. Responses are plain JSON dicts assembled in services/routers."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

FileRole = Literal["beneficiary registry", "attendance", "survey", "other"]


class LoginIn(BaseModel):
    email: str
    password: str


class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    program: str | None = None
    period_start: date
    period_end: date

    @model_validator(mode="after")
    def _period(self):
        if self.period_end < self.period_start:
            raise ValueError("period_end must be on or after period_start")
        return self


class ProjectPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    program: str | None = None
    period_start: date | None = None
    period_end: date | None = None


class DatasetPatch(BaseModel):
    role: FileRole


class SheetIn(BaseModel):
    sheet: str


class MappingItem(BaseModel):
    source_column: str
    canonical_field: str | None = None
    is_pii: bool = False


class MappingIn(BaseModel):
    columns: list[MappingItem]
    save_template: bool = False


class IssuePatch(BaseModel):
    status: Literal["open", "resolved", "accepted"]
    note: str | None = None

    @model_validator(mode="after")
    def _note_required(self):
        if self.status == "resolved" and not (self.note and self.note.strip()):
            raise ValueError("A note is required when resolving an issue")
        return self


class DecisionIn(BaseModel):
    decision: Literal["merge", "separate", "link", "reject", "undo"]
    note: str | None = None


class MetricIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=255)
    definition: str = Field(min_length=1)
    unit: str = "people"
    source_roles: list[str] = []
    calc: dict
    caveat: str | None = None

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        return v.strip().upper()


class MetricsIn(BaseModel):
    metrics: list[MetricIn]


class UnmaskIn(BaseModel):
    reason: str | None = None


__all__ = ["LoginIn", "RegisterIn", "ProjectIn", "ProjectPatch", "DatasetPatch", "SheetIn", "MappingIn",
           "MappingItem", "IssuePatch", "DecisionIn", "MetricIn", "MetricsIn", "UnmaskIn", "FileRole"]
