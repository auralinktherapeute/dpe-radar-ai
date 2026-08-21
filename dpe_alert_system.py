#!/usr/bin/env python3
"""
Système d'alertes DPE en temps réel
Détecte quand un propriétaire établit un DPE = VENTE IMMINENTE
Envoie webhook pour notification
"""

import psycopg2
import json
import time
from datetime import datetime, timedelta
import requests

class DPEAlertSystem:
    def __init__(self):
        self.conn = psycopg2.connect(
            host="localhost",
            database="dpe_radar",
            user="geraldhenry"
        )
        self.webhook_url = "http://localhost:9001/webhook"

    def monitor_new_dpe_alerts(self):
        """
        Détecte les propriétaires qui viennent d'établir un DPE
        = Très forte probabilité de vendre dans 1-3 mois
        = À contacter EN PREMIER avant l'agence
        """
        cur = self.conn.cursor()

        # DPE établis dans les 24 dernières heures
        cutoff = datetime.now() - timedelta(hours=24)

        cur.execute("""
        SELECT 
            t.id, t.email, t.phone, t.address, t.city, t.code_postal,
            d.dpe_grade, d.dpe_score, d.diagnostic_date,
            o.overall_score
        FROM therapeutes t
        LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
        LEFT JOIN opportunity_scores o ON t.id = o.property_id
        WHERE d.diagnostic_date >= %s
        ORDER BY d.diagnostic_date DESC
        """, (cutoff,))

        alerts = cur.fetchall()
        cur.close()

        if alerts:
            print(f"\n🔴 {len(alerts)} ALERTES DPE IMMINENTES (dernières 24h)")
            print("=" * 70)

        for alert in alerts:
            prop_id = alert[0]
            email = alert[1]
            phone = alert[2]
            address = alert[3]
            city = alert[4]
            grade = alert[6]
            score = alert[7]
            opportunity = alert[9] or 0

            # Email du propriétaire (pas d'agence!)
            owner_name = email.split('@')[0].title().replace('.', ' ')

            print(f"\n🔴 ALERTE IMMINENTE - Propriétaire à appeler EN PREMIER !")
            print(f"   Propriétaire: {owner_name}")
            print(f"   Propriété: {address}, {city}")
            print(f"   📧 {email}")
            print(f"   📞 {phone}")
            print(f"   Grade DPE: {grade} | Opportunité: {opportunity:.0f}/100")
            print(f"   Status: VEUT VENDRE PROBABLEMENT (DPE établi aujourd'hui)")

            # Envoyer webhook
            self.send_dpe_alert_webhook({
                'property_id': prop_id,
                'owner_email': email,
                'owner_phone': phone,
                'address': address,
                'city': city,
                'grade': grade,
                'opportunity_score': float(opportunity),
                'alert_type': 'DPE_ESTABLISHED_24H',
                'priority': 'URGENT',
                'action': 'APPELER LE PROPRIÉTAIRE EN PRIORITÉ'
            })

        return len(alerts)

    def send_dpe_alert_webhook(self, data):
        """Envoie une alerte webhook"""
        try:
            payload = {
                'timestamp': datetime.now().isoformat(),
                'event_type': 'dpe_alert',
                'data': data,
                'action': 'CONTACT_OWNER_FIRST'
            }

            response = requests.post(self.webhook_url, json=payload, timeout=5)
            if response.status_code == 200:
                print(f"   ✅ Webhook envoyé")
        except Exception as e:
            print(f"   ⚠️ Webhook non envoyé: {e}")

    def get_top_opportunities(self, limit=10):
        """Top 10 meilleures opportunités (ventes imminentes + haute opportunité)"""
        cur = self.conn.cursor()

        cur.execute(f"""
        SELECT 
            t.id, t.email, t.address, t.city,
            d.dpe_grade, o.overall_score,
            EXTRACT(DAY FROM NOW() - d.diagnostic_date) as days_ago
        FROM therapeutes t
        LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
        LEFT JOIN opportunity_scores o ON t.id = o.property_id
        WHERE d.diagnostic_date IS NOT NULL
        AND o.overall_score >= 70  -- Haute opportunité
        ORDER BY o.overall_score DESC
        LIMIT {limit}
        """)

        results = cur.fetchall()
        cur.close()

        return results

if __name__ == "__main__":
    print("""
╔════════════════════════════════════════════════════════════╗
║  🔴 DPE RADAR AI - SYSTÈME D'ALERTES IMMINENTES           ║
╚════════════════════════════════════════════════════════════╝

🎯 Stratégie : Contact propriétaires qui établissent un DPE
   = Première étape avant mise en vente
   = À appeler AVANT les agences immobilières

📊 Alertes détectées :
""")

    system = DPEAlertSystem()
    alerts_count = system.monitor_new_dpe_alerts()

    print(f"\n\n📈 TOP 10 OPPORTUNITÉS (Score ≥ 70/100) :")
    print("=" * 70)

    opportunities = system.get_top_opportunities(10)
    for i, opp in enumerate(opportunities, 1):
        owner_name = opp[1].split('@')[0].title().replace('.', ' ')
        print(f"\n{i}. {owner_name}")
        print(f"   📍 {opp[2]}, {opp[3]}")
        print(f"   Grade: {opp[4]} | Opportunité: {opp[5]:.0f}/100")
        print(f"   📧 {opp[1]} | Établi il y a {opp[6]:.0f}j")

    print("\n\n✅ Système opérationnel !")
    print("   Webhook: localhost:9001")
    print("   Alertes: Propriétaires qui établissent un DPE")

