#!/bin/bash
set -e

echo "🚀 DPE Radar AI - Starting..."
echo "📦 Python version: $(python3 --version)"

# Vérifier les dépendances
python3 -c "import psycopg2; print('✓ psycopg2')"
python3 -c "import requests; print('✓ requests')"

# Démarrer l'API
echo "🌐 Starting API server on port 8000..."
python3 /app/api_server.py
