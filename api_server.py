#!/usr/bin/env python3
"""
API DPE Radar AI - serveur autonome.

Source de donnees :
  - data.json (embarque dans le repo) par defaut
  - PostgreSQL si DATABASE_URL est defini (ou si --db est passe en local)

Ecoute sur 0.0.0.0:$PORT (8000 par defaut) pour fonctionner sur Render/Railway.
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta
import json
import math
import os
import unicodedata

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data.json')

# ---------------------------------------------------------------- chargement

def load_properties():
    """Charge les proprietes depuis PostgreSQL si dispo, sinon depuis data.json."""
    database_url = os.environ.get('DATABASE_URL')
    if database_url:
        try:
            import psycopg2
            conn = psycopg2.connect(database_url)
            cur = conn.cursor()
            cur.execute("""
            SELECT t.id, t.address, t.city, t.code_postal, t.latitude, t.longitude,
                   t.email, t.phone, d.dpe_grade, d.dpe_score,
                   d.diagnostic_date, o.overall_score
            FROM therapeutes t
            LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
            LEFT JOIN opportunity_scores o ON t.id = o.property_id
            ORDER BY t.id
            """)
            rows = []
            for r in cur.fetchall():
                rows.append({
                    'id': r[0], 'address': r[1], 'city': r[2], 'zip': r[3],
                    'latitude': float(r[4]) if r[4] else None,
                    'longitude': float(r[5]) if r[5] else None,
                    'email': r[6], 'phone': r[7],
                    'grade': r[8], 'dpe_score': r[9],
                    'diagnostic_date': r[10].isoformat() if r[10] else None,
                    'score': float(r[11]) if r[11] else 0,
                })
            cur.close()
            conn.close()
            print(f"[data] {len(rows)} proprietes chargees depuis PostgreSQL")
            return rows
        except Exception as e:
            print(f"[data] PostgreSQL indisponible ({e}), bascule sur data.json")

    with open(DATA_FILE, encoding='utf-8') as f:
        rows = json.load(f)
    print(f"[data] {len(rows)} proprietes chargees depuis data.json")
    return rows


PROPERTIES = load_properties()

# ------------------------------------------------------------------ helpers

def normalize(text):
    """minuscule, sans accent, sans tiret/espace : 'Sélestat' -> 'selestat'."""
    if not text:
        return ''
    text = unicodedata.normalize('NFD', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    return ''.join(c for c in text.lower() if c.isalnum())


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def list_cities():
    counts = {}
    for p in PROPERTIES:
        if p.get('city'):
            counts[p['city']] = counts.get(p['city'], 0) + 1
    return [{'name': name, 'count': counts[name]} for name in sorted(counts)]


def resolve_city(query):
    """Trouve la ville : exact, puis sans accent, puis correspondance partielle."""
    names = [c['name'] for c in list_cities()]
    q = normalize(query)
    for name in names:
        if normalize(name) == q:
            return name
    for name in names:
        n = normalize(name)
        if q and (q in n or n in q):
            return name
    return None


def city_center(city):
    pts = [(p['latitude'], p['longitude']) for p in PROPERTIES
           if p['city'] == city and p.get('latitude') and p.get('longitude')]
    if not pts:
        return None
    return (sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts))

# ---------------------------------------------------------------- endpoints

def endpoint_cities(_params):
    return list_cities()


def endpoint_search(params):
    query = params.get('city', [''])[0].strip()
    radius = float(params.get('radius', [5])[0])
    min_score = float(params.get('min_score', [0])[0])
    max_score = float(params.get('max_score', [100])[0])

    # Anciennete max du DPE, en jours. 0 ou absent = pas de filtre.
    days = int(params.get('days', [0])[0] or 0)
    cutoff = datetime.now() - timedelta(days=days) if days > 0 else None

    if not query:
        return {'error': 'ville manquante', 'available_cities': [c['name'] for c in list_cities()]}

    city = resolve_city(query)
    if not city:
        return {'error': f'ville "{query}" introuvable',
                'available_cities': [c['name'] for c in list_cities()]}

    center = city_center(city)
    if not center:
        return {'error': f'pas de coordonnees pour "{city}"',
                'available_cities': [c['name'] for c in list_cities()]}

    ref_lat, ref_lon = center
    results = []
    for p in PROPERTIES:
        if not (p.get('latitude') and p.get('longitude')):
            continue
        distance = haversine_km(ref_lat, ref_lon, p['latitude'], p['longitude'])
        if distance > radius:
            continue
        score = p.get('score') or 0
        if not (min_score <= score <= max_score):
            continue

        established = None
        if p.get('diagnostic_date'):
            try:
                established = datetime.fromisoformat(p['diagnostic_date'])
            except ValueError:
                established = None
        if cutoff and (established is None or established < cutoff):
            continue

        results.append({
            'id': p['id'], 'address': p['address'], 'city': p['city'], 'zip': p['zip'],
            'grade': p.get('grade') or 'N/A', 'score': score,
            'email': p.get('email'), 'phone': p.get('phone'),
            'owner_name': p.get('owner_name'),
            'diagnostic_date': p.get('diagnostic_date'),
            'days_ago': (datetime.now() - established).days if established else None,
            'distance_km': round(distance, 2),
            # Donnees ADEME reelles
            'numero_dpe': p.get('numero_dpe'),
            'surface_m2': p.get('surface_m2'),
            'type_batiment': p.get('type_batiment'),
            'conso_kwh_m2_an': p.get('conso_kwh_m2_an'),
            'grade_ges': p.get('grade_ges'),
            'source': p.get('source'),
        })
    results.sort(key=lambda r: r['distance_km'])
    return results


def endpoint_alerts(params):
    hours = int(params.get('hours', [24])[0])
    limit = int(params.get('limit', [20])[0])
    cutoff = datetime.now() - timedelta(hours=hours)

    alerts = []
    for p in PROPERTIES:
        # L'alerte repose sur la date du DPE, pas sur la presence d'un contact :
        # les donnees ADEME n'en contiennent aucun.
        if not p.get('diagnostic_date'):
            continue
        try:
            # L'ADEME date au jour (2026-08-10), sans heure.
            established = datetime.fromisoformat(p['diagnostic_date'])
        except ValueError:
            continue
        if established < cutoff:
            continue
        hours_ago = int((datetime.now() - established).total_seconds() // 3600)
        alerts.append({
            'id': p['id'], 'address': p['address'], 'city': p['city'], 'zip': p['zip'],
            'email': p['email'], 'phone': p.get('phone'),
            'dpe_grade': p.get('grade') or 'N/A', 'dpe_score': p.get('dpe_score'),
            'diagnostic_date': p['diagnostic_date'],
            'opportunity_score': p.get('score') or 0,
            'hours_ago': hours_ago,
            'days_ago': hours_ago // 24,
            'surface_m2': p.get('surface_m2'),
            'type_batiment': p.get('type_batiment'),
            'numero_dpe': p.get('numero_dpe'),
            'alert_priority': 'URGENT' if hours_ago < 12 else 'HIGH',
        })
    alerts.sort(key=lambda a: a['opportunity_score'], reverse=True)
    return alerts[:limit]


def endpoint_properties(_params):
    return [{
        'id': p['id'], 'address': p['address'], 'city': p['city'],
        'grade': p.get('grade') or 'N/A', 'score': p.get('score') or 0,
        'email': p.get('email'), 'phone': p.get('phone'),
        'diagnostic_date': p.get('diagnostic_date'),
    } for p in PROPERTIES]


ROUTES = {
    '/api/cities': endpoint_cities,
    '/api/search': endpoint_search,
    '/api/dpe-alerts': endpoint_alerts,
    '/api/properties': endpoint_properties,
}

# ------------------------------------------------------------------- server

class APIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        handler = ROUTES.get(parsed.path)

        if handler:
            try:
                payload = handler(parse_qs(parsed.query))
                self._send_json(200, payload)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        if parsed.path in ('/', ''):
            self.path = '/results.html'
        elif parsed.path == '/health':
            self._send_json(200, {'status': 'ok', 'properties': len(PROPERTIES)})
            return

        return super().do_GET()

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        return super().end_headers()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    server = HTTPServer(('0.0.0.0', port), APIHandler)
    print(f"""
+------------------------------------------------------------+
|            DPE Radar AI - Serveur API demarre              |
+------------------------------------------------------------+

  Port      : {port}
  Donnees   : {len(PROPERTIES)} proprietes
  Endpoints : /api/cities  /api/search  /api/dpe-alerts
              /api/properties  /health
""", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur arrete")
