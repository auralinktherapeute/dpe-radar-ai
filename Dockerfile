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

# Santé check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/cities').read()" || exit 1

# Lancer via script
CMD ["bash", "start.sh"]
