FROM python:3.12-slim

# Dependencias de sistema para OpenCV / onnxruntime
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# Precargar el modelo por defecto (isnet) en la imagen -> sin descarga en el primer request.
# Los otros modelos (birefnet / u2net) se bajan solos la primera vez que se usan.
RUN python -c "from rembg import new_session; new_session('isnet-general-use')"

ENV PORT=8000
# Railway / Render inyectan $PORT. Un solo worker: los modelos viven en RAM por proceso.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT} --workers 1"]
