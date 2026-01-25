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

# Create data directory
RUN mkdir -p data

EXPOSE 5000

# Run Flask
CMD ["python", "backend/app.py"]
