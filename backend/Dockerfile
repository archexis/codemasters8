FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core tesseract-ocr tesseract-ocr-rus && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.lock.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend /app/backend
RUN useradd --create-home appuser && mkdir -p /app/backend/.data && chown appuser:appuser /app/backend/.data
USER appuser
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
