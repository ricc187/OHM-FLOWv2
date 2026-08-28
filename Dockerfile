# Build Stage for React
FROM node:20-alpine as build

WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Production Stage for Flask
# 3.13 (not the previous 3.9) — matches the Python version this app has
# actually been developed/tested against, and Pillow==12.3.0 requires >=3.10
# (3.9 fails to resolve it at all).
FROM python:3.13-slim

WORKDIR /app

# Install dependencies first for caching
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend assets
COPY --from=build /app/dist ./dist

# Create data directory structure
RUN mkdir -p data/uploads

# app.py and its sibling modules (financier_calculs.py, auth_security.py,
# mfa.py — all plain `import x`, no package-relative dots, since app.py is
# normally just run directly as `python backend/app.py`) live in backend/,
# not on gunicorn's import path here: gunicorn imports "backend.app" as a
# package member, which only puts /app (WORKDIR, the cwd app.py's own data/
# dir resolution still depends on) on sys.path — not /app/backend itself.
# Add it explicitly rather than converting every sibling import to a
# relative one, which would break running app.py directly the normal way.
ENV PYTHONPATH=/app/backend

EXPOSE 5000

# Run Flask with Gunicorn.
# 4 worker processes so concurrent requests don't queue behind each other.
# SQLite is in WAL mode (see app.py) specifically so this is safe: WAL allows
# many concurrent readers alongside a single writer without locking errors —
# the old 1-worker setting predated WAL and was serializing every request.
CMD ["gunicorn", "-w", "4", "--timeout", "60", "-b", "0.0.0.0:5000", "backend.app:app"]
