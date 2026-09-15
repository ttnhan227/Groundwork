FROM python:3.12-slim

WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=1000 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install runtime dependencies (tesseract, libreoffice for document processing, curl for health check)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    tesseract-ocr \
    tesseract-ocr-eng \
    curl \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install Python dependencies directly from pre-built wheels
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .
RUN chmod +x /app/start.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["/app/start.sh"]
