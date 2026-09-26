# ImpactTrace – traceable impact reporting for small nonprofits

Upload messy Excel/CSV files, match columns, clean and check the data, merge duplicate people, compute clearly
defined metrics, and publish a report where **every number links back to the original file and row**.
Original files are never modified. Built for Problem Statement 2 (see `docs/PRD_ImpactTrace.md`).

## Run it

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

| | |
|---|---|
| App | http://localhost:5173 |
| API docs (Swagger) | http://localhost:8000/docs |
| Demo login | `demo@impacttrace.org` / `impact123` (user **Neurobot**) |

On first start the backend loads `sample_data/` into the database as the project **Digital Literacy 2026 – Q1**
(already mapped and cleaned). Open it, go to **Clean & review → Duplicates**, merge the two suggested pairs and confirm
Deepak Kumar's name-only link; the report then shows the answer-key figures.

Manual start:

```powershell
cd backend;  python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
cd frontend; npm install; npm run dev
```

Deploy (one container, no Netlify needed): `deploy\huggingface\build_space.ps1` prepares `hf_space/` for a Hugging Face
Docker Space; the backend serves the built frontend when `frontend/dist` exists.
Or split: backend on Render (`render.yaml` – New + › Blueprint), frontend on Netlify (`netlify.toml`, or drag
`frontend/dist` onto Netlify Drop). Netlify forwards `/api/*` to the Render URL in `frontend/public/_redirects`.
The free Render disk is wiped on restart, so the database resets to the sample project.

Tests (backend, checks the answer key end-to-end): `cd backend; .\.venv\Scripts\python -m pytest -q`

## Expected results on the sample data

| Metric | Before review | After merging BEN-001/008, BEN-002/015 and linking Deepak |
|---|---|---|
| M1 Unique beneficiaries enrolled | 22 | **20** (3 excluded: 2 missing dates, 1 future date) |
| M2 Active participants (≥ 2 sessions) | 3 | **3** – Priya Sharma, Rahul Verma, Anita Das |
| M3 Total session attendances | 18 | **19** |
| M4 Average confidence gain | +1.89 | **+1.89** (17 ÷ 9) |
| M5 Survey response rate | 45.5% | **50%** (10 ÷ 20) |

All 23 checklist items in `sample_data/DATA_ISSUES_ANSWER_KEY.md` are covered: 16 raise issues (20 issue rows in total)
and the 7 formatting items appear as logged standardisations. See `backend/tests/test_sample_data_answer_key.py`.

## How it works

```
Upload ─► raw rows (immutable, SHA-256) ─► column mapping ─► standardise (working copy, every change logged)
      ─► validate (issues) ─► exact + fuzzy duplicates (human decides) ─► link attendance/survey to people
      ─► metrics (contributing + excluded rows stored) ─► report with drill-down ─► masked PDF/CSV export
```

* **Never overwrites originals** – raw rows have no update/delete path; SQLite triggers reject changes. Re-upload = new version.
* **Never guesses** – missing values are flagged, not filled; ambiguous dates are read day-first and listed as an assumption.
* **Never auto-merges** – score ≥ 90 is only *suggested*; 70–89 needs review; name-only matches (no phone) are capped at 89.
* **Traceable** – each metric result stores included and excluded records with a reason; `/metric-results/{id}/trace`
  and `/records/{id}/lineage` show file, sheet, row, original values and every transformation.
* **Honest wording** – causal words ("caused", "proved") are rejected in metric definitions; caveats sit beside numbers.
* **Private by default** – names/phones masked in screens and exports (`P**** S*****`, `******0101`); exports use HMAC
  pseudonymous IDs; switching on "Show personal data" or exporting unmasked is written to the audit log.

## Layout

```
backend/   FastAPI + SQLAlchemy (SQLite). app/services/* hold the logic (ingestion, mapping, standardise, validate,
           dedupe, linking, metrics, report, privacy, audit); app/routers/* are the REST endpoints (/api/v1).
frontend/  React 18 + Vite + TypeScript + Tailwind + TanStack Query. Screens follow docs/STITCH_PROMPTS.md and
           the tokens in docs/DESIGN.md.
sample_data/  the three synthetic files, metric_definitions.json (with machine-readable "calc" blocks), answer key.
docs/      PRD, design system, Stitch prompts, flowchart, AI Studio OpenAPI sketch.
```

Notes: PDF export uses xhtml2pdf instead of WeasyPrint (WeasyPrint needs GTK on Windows). Secrets
(`IMPACTTRACE_HMAC_SECRET`, `IMPACTTRACE_JWT_SECRET`) come from `backend/.env` – see `backend/.env.example`.
