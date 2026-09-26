# ImpactTrace as a single Hugging Face Docker Space: the FastAPI backend also serves the built React app.

# 1) Build the frontend
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 2) Python API + static frontend. Spaces run as uid 1000 and expect port 7860; other hosts (Render, Koyeb) set $PORT.
FROM python:3.11-slim
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir --user -r backend/requirements.txt
COPY --chown=user backend/app backend/app
COPY --chown=user sample_data sample_data
COPY --chown=user --from=web /web/dist frontend/dist

WORKDIR /home/user/app/backend
EXPOSE 7860
# Secrets: set IMPACTTRACE_JWT_SECRET / IMPACTTRACE_HMAC_SECRET in the Space settings, otherwise random ones are
# generated per boot (fine here: the Space disk is wiped on restart anyway).
CMD ["sh", "-c", "export IMPACTTRACE_JWT_SECRET=\"${IMPACTTRACE_JWT_SECRET:-$(python -c 'import secrets;print(secrets.token_hex(32))')}\" IMPACTTRACE_HMAC_SECRET=\"${IMPACTTRACE_HMAC_SECRET:-$(python -c 'import secrets;print(secrets.token_hex(32))')}\"; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
