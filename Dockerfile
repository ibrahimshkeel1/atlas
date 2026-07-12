# Railway-friendly build when Root Directory is the repo root.
# (If Root Directory is set to apps/api, that folder's Dockerfile is used instead.)
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/ .

RUN chmod +x scripts/start_api.sh scripts/start_worker.sh

EXPOSE 8000
CMD ["sh", "scripts/start_api.sh"]
