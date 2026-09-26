import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_project
from app.models import Project, User
from app.security import get_current_user
from app.services import audit, report

router = APIRouter(tags=["reports"])


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")[:60] or "report"


@router.get("/projects/{project_id}/report")
def get_report(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    return report.build_report(db, p)


@router.get("/projects/{project_id}/report/html", response_class=HTMLResponse)
def report_html(p: Project = Depends(get_project), db: Session = Depends(get_db)):
    return report.render_html(db, p, reveal=False)


@router.get("/projects/{project_id}/report/export")
def export(format: Literal["pdf", "csv"] = "pdf", masked: bool = True, p: Project = Depends(get_project),
           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not p.metrics_computed_at:
        raise HTTPException(422, "Compute metrics before exporting.")
    reveal = not masked
    audit.log(db, p.id, "privacy" if reveal else "export", rule=f"export_{format}_{'unmasked' if reveal else 'masked'}",
              user=user.email, note="Personal data included in export" if reveal else "Personal data masked")
    db.commit()
    name = f"{_slug(p.name)}_report"
    if format == "csv":
        return Response(report.export_csv(db, p, reveal), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
    return Response(report.export_pdf(db, p, reveal), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
