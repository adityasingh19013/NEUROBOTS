from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Dataset, Project, User
from app.security import get_current_user


def get_project(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> Project:
    p = db.get(Project, project_id)
    if p is None:
        raise HTTPException(404, "Project not found")
    return p


def get_dataset(dataset_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> Dataset:
    d = db.get(Dataset, dataset_id)
    if d is None:
        raise HTTPException(404, "File not found")
    return d
