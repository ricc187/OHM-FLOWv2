# Build Stage for React
FROM node:20-alpine as build

WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Production Stage for Flask
FROM python:3.9-slim

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

EXPOSE 5000

# Run Flask with Gunicorn.
# 4 worker processes so concurrent requests don't queue behind each other.
# SQLite is in WAL mode (see app.py) specifically so this is safe: WAL allows
# many concurrent readers alongside a single writer without locking errors —
# the old 1-worker setting predated WAL and was serializing every request.
CMD ["gunicorn", "-w", "4", "--timeout", "60", "-b", "0.0.0.0:5000", "backend.app:app"]
