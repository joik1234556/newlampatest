FROM python:3.12-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir gunicorn==22.0.0

# Copy application code
COPY app/ ./app/
COPY static/ ./static/

# Create .env if not present (env_file in compose will provide actual values)
RUN touch .env

EXPOSE 8000

# Use gunicorn with uvicorn workers for better multi-core utilisation and
# graceful process management.  4 workers × async event loop handles 30-50
# concurrent users well on a 2-core / 4 GB server while keeping memory
# consumption well below the 4 GB limit (~250-350 MB per worker).
# --timeout 120 prevents slow TorBox poll requests from being killed prematurely.
CMD ["gunicorn", "app.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "4", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--keep-alive", "5", \
     "--max-requests", "1000", \
     "--max-requests-jitter", "100"]
