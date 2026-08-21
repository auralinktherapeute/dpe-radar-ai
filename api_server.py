#!/usr/bin/env python3
"""
API simple pour servir les données DPE Radar AI
Ouvre http://localhost:8000 dans le navigateur
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import psycopg2
import os
from urllib.parse import urlparse, parse_qs

class APIHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # API endpoint alertes DPE (VRAIS contacts propriétaires)
        if self.path.startswith('/api/dpe-alerts'):
            try:
                from urllib.parse import urlparse, parse_qs
                parsed = urlparse(self.path)
                params = parse_qs(parsed.query)

                hours = int(params.get('hours', [24])[0])
                limit = int(params.get('limit', [20])[0])

                conn = psycopg2.connect(
                    host="localhost",
                    database="dpe_radar",
                    user=os.environ.get('USER', 'geraldhenry')
                )
                cur = conn.cursor()

                # Récupérer les alertes DPE récentes
                cur.execute(f"""
                SELECT
                    t.id, t.address, t.city, t.code_postal,
                    t.email, t.phone,
                    d.dpe_grade, d.dpe_score, d.diagnostic_date,
                    o.overall_score,
                    EXTRACT(HOUR FROM NOW() - d.diagnostic_date) as hours_ago
                FROM therapeutes t
                LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
                LEFT JOIN opportunity_scores o ON t.id = o.property_id
                WHERE d.diagnostic_date >= NOW() - INTERVAL '{hours} hours'
                AND t.email IS NOT NULL
                ORDER BY d.diagnostic_date DESC
                LIMIT {limit}
                """)

                alerts = []
                for row in cur.fetchall():
                    alerts.append({
                        'id': row[0],
                        'address': row[1],
                        'city': row[2],
                        'zip': row[3],
                        'email': row[4],
                        'phone': row[5],
                        'dpe_grade': row[6],
                        'dpe_score': row[7],
                        'diagnostic_date': row[8].isoformat() if row[8] else None,
                        'opportunity_score': float(row[9]) if row[9] else 0,
                        'hours_ago': int(row[10]) if row[10] else 0,
                        'alert_priority': 'URGENT' if row[10] and row[10] < 12 else 'HIGH'
                    })

                cur.close()
                conn.close()

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(alerts).encode())
                return

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                return

        # API endpoint recherche géographique
        if self.path.startswith('/api/search'):
            try:
                from urllib.parse import urlparse, parse_qs
                parsed = urlparse(self.path)
                params = parse_qs(parsed.query)

                city = params.get('city', [''])[0]
                radius = int(params.get('radius', [5])[0])
                min_score = int(params.get('min_score', [0])[0])
                max_score = int(params.get('max_score', [100])[0])

                conn = psycopg2.connect(
                    host="localhost",
                    database="dpe_radar",
                    user=os.environ.get('USER', 'geraldhenry')
                )
                cur = conn.cursor()

                # Récupérer coordonnées de la ville
                cur.execute("""
                SELECT latitude, longitude FROM therapeutes
                WHERE city = %s AND latitude IS NOT NULL LIMIT 1
                """, (city,))

                result = cur.fetchone()
                if not result:
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps([]).encode())
                    return

                ref_lat, ref_lon = result

                # Récupérer toutes les propriétés avec distances
                cur.execute("""
                SELECT
                    t.id, t.address, t.city, t.code_postal,
                    t.latitude, t.longitude, t.email, t.phone,
                    d.dpe_grade, o.overall_score, d.diagnostic_date,
                    SQRT(POWER(t.latitude - %s, 2) + POWER(t.longitude - %s, 2)) * 111 as distance
                FROM therapeutes t
                LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
                LEFT JOIN opportunity_scores o ON t.id = o.property_id
                WHERE t.latitude IS NOT NULL
                ORDER BY distance ASC
                """, (ref_lat, ref_lon))

                properties = []
                for row in cur.fetchall():
                    distance = row[11]
                    if distance <= radius:
                        score = float(row[9]) if row[9] else 0
                        if min_score <= score <= max_score:
                            diagnostic_date = row[10].isoformat() if row[10] else None
                            properties.append({
                                'id': row[0],
                                'address': row[1],
                                'city': row[2],
                                'zip': row[3],
                                'grade': row[8],
                                'score': score,
                                'email': row[6],
                                'phone': row[7],
                                'distance_km': round(float(distance), 2),
                                'diagnostic_date': diagnostic_date
                            })

                cur.close()
                conn.close()

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(properties).encode())
                return

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                return

        # API endpoint pour les propriétés
        if self.path.startswith('/api/properties'):
            try:
                conn = psycopg2.connect(
                    host="localhost",
                    database="dpe_radar",
                    user=os.environ.get('USER', 'geraldhenry')
                )
                cur = conn.cursor()

                cur.execute("""
                SELECT
                    t.id,
                    t.address,
                    t.city,
                    d.dpe_grade,
                    o.overall_score,
                    t.email,
                    t.phone
                FROM therapeutes t
                LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
                LEFT JOIN opportunity_scores o ON t.id = o.property_id
                ORDER BY t.id
                LIMIT 500
                """)

                properties = []
                for row in cur.fetchall():
                    properties.append({
                        'id': row[0],
                        'address': row[1],
                        'city': row[2],
                        'grade': row[3],
                        'score': float(row[4]) if row[4] else 0,
                        'email': row[5],
                        'phone': row[6]
                    })

                cur.close()
                conn.close()

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(properties).encode())
                return

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
                return

        # Servir les fichiers statiques (HTML, CSS, JS)
        if self.path == '/' or self.path == '':
            self.path = '/results.html'

        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        return super().end_headers()

if __name__ == '__main__':
    os.chdir('/Users/geraldhenry/Downloads/dpe-radar-ai')

    server = HTTPServer(('localhost', 8000), APIHandler)
    print("""
╔════════════════════════════════════════════════════════════╗
║         🚀 DPE Radar AI - Serveur API Démarré            ║
╚════════════════════════════════════════════════════════════╝

📍 Ouvre dans le navigateur :
   http://localhost:8000

📊 API disponible :
   GET /api/properties → Retourne toutes les propriétés en JSON

Appuie sur Ctrl+C pour arrêter le serveur
    """)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n✅ Serveur arrêté")
