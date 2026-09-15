# Multi-stage build for Python backend
# Stage 1: Builder - compile dependencies
FROM python:3.12-slim AS builder

WORKDIR /build
ENV PIP_DEFAULT_TIMEOUT=1000 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Install build dependencies needed for wheel compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and build wheels
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels -r requirements.txt

# Stage 2: Runtime - minimal dependencies only
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

# Copy wheels from builder and install
COPY --from=builder /build/wheels /wheels
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache /wheels/*.whl -r requirements.txt && \
    rm -rf /wheels

# Copy application code
COPY . .
RUN chmod +x /app/start.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["/app/start.sh"]
