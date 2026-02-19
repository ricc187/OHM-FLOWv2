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

# Run Flask with Gunicorn
# Run Flask with Gunicorn
# Using 1 worker to prevent SQLite database locking issues
CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:5000", "backend.app:app"]
