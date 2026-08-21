FROM python:3.11-slim

WORKDIR /app

# Installer dépendances
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copier requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || \
    pip install psycopg2-binary requests geopy

# Copier l'app
COPY . .

# Exposer le port
EXPOSE 8000

# Lancer l'API
CMD ["python3", "api_server_v2.py"]
