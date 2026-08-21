#!/usr/bin/env python3
"""
Webhook Service - Notifications temps réel des alertes DPE
Envoie des notifications quand :
  - Un nouveau DPE est établi
  - Un nouveau contact est scraped
  - Une nouvelle opportunité détectée
"""

import json
import psycopg2
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import time

class WebhookHandler(BaseHTTPRequestHandler):
    """Reçoit et traite les webhooks"""

    def do_POST(self):
        """Reçoit les événements"""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        
        try:
            data = json.loads(body.decode('utf-8'))
            
            # Logger l'événement
            print(f"📬 Webhook reçu : {data.get('event_type')}")
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'received'}).encode())
            
        except Exception as e:
            self.send_response(400)
            self.end_headers()
            print(f"❌ Erreur webhook: {e}")

    def do_GET(self):
        """Health check"""
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """Suppress logs"""
        pass

class WebhookService:
    def __init__(self, port=9001):
        self.port = port
        self.server = None
        self.thread = None

    def start(self):
        """Démarre le serveur webhook"""
        self.server = HTTPServer(('localhost', self.port), WebhookHandler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.daemon = True
        self.thread.start()
        print(f"✅ Webhook server lancé sur localhost:{self.port}")

    def send_alert(self, event_type, data, webhook_url=None):
        """Envoie une alerte webhook"""
        import requests
        
        payload = {
            'timestamp': datetime.now().isoformat(),
            'event_type': event_type,
            'data': data
        }
        
        if webhook_url:
            try:
                requests.post(webhook_url, json=payload, timeout=5)
                print(f"✅ Alerte envoyée : {event_type}")
            except Exception as e:
                print(f"⚠️ Erreur envoi webhook: {e}")

def monitor_dpe_changes(webhook_url=None):
    """Monitore les changements DPE et envoie des webhooks"""
    conn = psycopg2.connect(
        host="localhost",
        database="dpe_radar",
        user="geraldhenry"
    )
    
    last_check = datetime.now()
    
    while True:
        try:
            cur = conn.cursor()
            
            # Chercher les DPE établis depuis le dernier check
            cur.execute("""
            SELECT t.id, t.address, t.city, d.dpe_grade, 
                   d.diagnostic_date, o.overall_score
            FROM therapeutes t
            LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
            LEFT JOIN opportunity_scores o ON t.id = o.property_id
            WHERE d.diagnostic_date > %s
            ORDER BY d.diagnostic_date DESC
            LIMIT 10
            """, (last_check,))
            
            new_dpes = cur.fetchall()
            
            for dpe in new_dpes:
                event = {
                    'property_id': dpe[0],
                    'address': dpe[1],
                    'city': dpe[2],
                    'grade': dpe[3],
                    'timestamp': dpe[4].isoformat() if dpe[4] else None,
                    'opportunity_score': float(dpe[5]) if dpe[5] else 0,
                    'alert_priority': 'URGENT'
                }
                
                print(f"🔴 Nouveau DPE détecté: {dpe[1]}, {dpe[2]}")
                
                if webhook_url:
                    requests.post(webhook_url, json={
                        'event': 'new_dpe_alert',
                        'data': event
                    })
            
            last_check = datetime.now()
            cur.close()
            
        except Exception as e:
            print(f"❌ Erreur monitor: {e}")
        
        time.sleep(60)  # Check toutes les minutes

if __name__ == "__main__":
    print("""
╔════════════════════════════════════════════════════════════╗
║  🔔 DPE RADAR AI - WEBHOOK SERVICE                         ║
╚════════════════════════════════════════════════════════════╝

📡 Webhook Events :
   • new_dpe_alert : DPE établi
   • new_contact : Contact scraped
   • new_opportunity : Opportunité détectée

📍 URL Webhook : http://localhost:9001/webhook
🏥 Health Check : http://localhost:9001/health

Exemples d'utilisation :
   curl -X POST http://localhost:9001/webhook \\
     -H "Content-Type: application/json" \\
     -d '{"event_type": "test", "data": {"test": true}}'
    """)
    
    service = WebhookService(port=9001)
    service.start()
    
    # Monitorer les changements
    print("\n🔔 En attente d'événements...\n")
    try:
        monitor_dpe_changes(webhook_url="http://your-server.com/webhook")
    except KeyboardInterrupt:
        print("\n✋ Webhook service arrêté")

