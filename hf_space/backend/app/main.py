from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.routers import audit, auth, datasets, metrics, processing, projects, reports
from app.security import ensure_demo_user
from app.services.seed import seed_if_empty


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with SessionLocal() as db:
        ensure_demo_user(db)
        if get_settings().seed_sample_project:
            seed_if_empty(db)
    yield


app = FastAPI(title="ImpactTrace API", version="1.0.0",
              description="Traceable impact reporting for small nonprofits", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])

API = "/api/v1"
for r in (auth.router, projects.router, datasets.router, processing.router, metrics.router, reports.router,
          audit.router):
    app.include_router(r, prefix=API)


@app.get(f"{API}/health", tags=["meta"])
def health():
    return {"status": "ok"}


_dist = get_settings().frontend_dist.resolve()
if (_dist / "index.html").is_file():
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        # Unknown API paths stay 404s; everything else is a static file or a React Router route.
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        file = (_dist / path).resolve()
        if path and file.is_file() and file.is_relative_to(_dist):
            return FileResponse(file)
        return FileResponse(_dist / "index.html")
