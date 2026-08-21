#!/usr/bin/env python3
"""
Service de synchronisation ADEME + DataGouv
Récupère les DPE récemment établis avec infos propriétaire
Mettre à jour progressivement la BD avec VRAIS contacts
"""

import requests
import json
import psycopg2
from datetime import datetime, timedelta
import time

class ADEMESyncService:
    def __init__(self):
        self.conn = psycopg2.connect(
            host="localhost",
            database="dpe_radar",
            user="geraldhenry"
        )
        # DataGouv expose les données ADEME en open data
        self.datagouv_url = "https://data.ademe.org/api/3/action/datastore_search_sql"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'DPE-Radar-AI/1.0'
        })

    def get_recent_dpe_from_datagouv(self, limit=50):
        """
        Récupère les DPE établis récemment depuis DataGouv
        DataGouv expose les données ADEME publiquement
        """
        try:
            # Query DataGouv pour les DPE récents
            sql_query = """
            SELECT "Adresse", "Commune", "Code_postal", 
                   "Classe_DPE", "Consommation_energy", 
                   "Nom_propriétaire", "Telephone_propriétaire", 
                   "Email_propriétaire", "Date_DPE"
            FROM "dpe_diagnostics"
            WHERE "Date_DPE" >= NOW() - INTERVAL 30 DAY
            ORDER BY "Date_DPE" DESC
            LIMIT {limit}
            """.format(limit=limit)

            # Tentative 1: API DataGouv directe
            payload = {
                'sql': sql_query,
                'resource_id': 'dpe-v2-logements-existants'  # ID DataGouv
            }

            print("📡 Tentative API DataGouv...")
            response = self.session.get(
                self.datagouv_url,
                params=payload,
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                if 'records' in data:
                    print(f"✅ {len(data['records'])} DPE récents trouvés")
                    return data['records']

            print("⚠️ API DataGouv indisponible")
            return []

        except Exception as e:
            print(f"❌ Erreur DataGouv: {e}")
            return []

    def sync_dpe_from_csv(self, csv_file):
        """
        Alternative : Importer depuis CSV local
        (Pour test ou import manuel de données ADEME)
        """
        import csv

        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                properties = list(reader)

            print(f"✅ {len(properties)} propriétés chargées du CSV")
            return properties

        except Exception as e:
            print(f"❌ Erreur lecture CSV: {e}")
            return []

    def update_property_with_real_contact(self, address, city, zip_code, 
                                         dpe_grade, email, phone, source="ademe"):
        """
        Met à jour une propriété avec les VRAIS contacts du propriétaire
        (au lieu des contacts d'agence)
        """
        cur = self.conn.cursor()

        try:
            # Chercher la propriété par adresse
            cur.execute("""
            SELECT id FROM therapeutes
            WHERE LOWER(address) LIKE %s AND LOWER(city) LIKE %s
            LIMIT 1
            """, (
                f"%{address.lower()}%",
                f"%{city.lower()}%"
            ))

            result = cur.fetchone()
            if result:
                prop_id = result[0]

                # Mettre à jour avec les vrais contacts
                cur.execute("""
                UPDATE therapeutes
                SET email = %s, phone = %s, website = %s
                WHERE id = %s
                """, (email, phone, f"owner-{source}", prop_id))

                # Log la mise à jour
                cur.execute("""
                INSERT INTO agent_logs (agent_name, action, data, created_at)
                VALUES (%s, %s, %s, NOW())
                """, (
                    'ademe_sync',
                    'contact_updated',
                    json.dumps({
                        'property_id': prop_id,
                        'email': email,
                        'phone': phone,
                        'source': source
                    })
                ))

                self.conn.commit()
                return True

            return False

        except Exception as e:
            print(f"❌ Erreur update: {e}")
            self.conn.rollback()
            return False
        finally:
            cur.close()

    def monitor_new_dpe_alerts(self, hours=24):
        """
        Crée des alertes pour les DPE établis dans les N dernières heures
        = propriétaires qui veulent vendre IMMINENTE
        """
        cur = self.conn.cursor()

        cutoff = datetime.now() - timedelta(hours=hours)

        cur.execute("""
        SELECT t.id, t.address, t.city, t.code_postal,
               d.dpe_grade, d.diagnostic_date, d.dpe_score
        FROM therapeutes t
        LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
        WHERE d.diagnostic_date >= %s
        ORDER BY d.diagnostic_date DESC
        """, (cutoff,))

        alerts = cur.fetchall()
        cur.close()

        print(f"\n🔴 ALERTES DPE (dernières {hours}h) : {len(alerts)} propriétés")
        for alert in alerts[:10]:
            print(f"   • {alert[1]}, {alert[2]} - Grade {alert[4]}")

        return alerts

    def sync_batch(self, properties_data):
        """
        Synchronise un batch de propriétés avec les données ADEME
        Enrichit la BD avec les vrais contacts
        """
        updated = 0
        for prop in properties_data:
            success = self.update_property_with_real_contact(
                address=prop.get('Adresse') or prop.get('address'),
                city=prop.get('Commune') or prop.get('city'),
                zip_code=prop.get('Code_postal') or prop.get('zip'),
                dpe_grade=prop.get('Classe_DPE') or prop.get('grade'),
                email=prop.get('Email_propriétaire') or prop.get('email'),
                phone=prop.get('Telephone_propriétaire') or prop.get('phone'),
                source='ademe'
            )
            if success:
                updated += 1
            time.sleep(0.1)  # Rate limit respectueux

        print(f"✅ {updated} propriétés enrichies avec vrais contacts ADEME")
        return updated

if __name__ == "__main__":
    print("🚀 Service de Synchronisation ADEME\n")

    sync = ADEMESyncService()

    # Test 1 : Monitorer les alertes récentes
    print("=" * 60)
    sync.monitor_new_dpe_alerts(hours=24)

    # Test 2 : Afficher la stratégie
    print("\n" + "=" * 60)
    print("\n🎯 STRATÉGIE DE PROSPECTION ACTIVE\n")
    print("""
    1. Service détecte les DPE établis dans les 24 dernières heures
    2. = Propriétaire envisage une vente IMMINENTE
    3. Contact propriétaire AVANT agence immobilière
    4. Export CSV → Email de prospection automatique
    """)

    print("\n📊 Prochaines étapes :")
    print("   • Importer données ADEME CSV (si accès API bloquer)")
    print("   • Lancer sync toutes les heures")
    print("   • Laisser Obscura scraper enrichir en parallèle")
    print("   • Tableau de bord des alertes en temps réel")

