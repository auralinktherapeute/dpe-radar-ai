#!/usr/bin/env python3
"""
Import de propriétés dans DPE Radar AI
Lire depuis CSV et insérer en base de données
"""

import csv
import sys
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime

def connect_db():
    """Connexion à PostgreSQL"""
    try:
        conn = psycopg2.connect(
            host="localhost",
            database="dpe_radar",
            user="geraldhenry"
        )
        return conn
    except Exception as e:
        print(f"❌ Erreur connexion DB: {e}")
        sys.exit(1)

def import_csv(csv_file):
    """Importer un fichier CSV"""
    conn = connect_db()
    cur = conn.cursor()

    try:
        properties = []

        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                prop_id = row.get('id') or f"prop-{datetime.now().timestamp()}"
                properties.append((
                    prop_id,
                    row.get('address', ''),
                    row.get('city', ''),
                    row.get('zip', ''),
                    row.get('latitude', 0),
                    row.get('longitude', 0),
                    row.get('email', ''),
                    row.get('phone', ''),
                    row.get('website', ''),
                    float(row.get('rating', 0)) if row.get('rating') else 0,
                    int(row.get('reviews_count', 0)) if row.get('reviews_count') else 0,
                    row.get('verified', 'false').lower() == 'true'
                ))

        # Insert en masse
        sql = """
        INSERT INTO therapeutes
        (id, address, city, code_postal, latitude, longitude, email, phone, website, rating, reviews_count, verified)
        VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            address = EXCLUDED.address,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            website = EXCLUDED.website,
            rating = EXCLUDED.rating,
            reviews_count = EXCLUDED.reviews_count,
            verified = EXCLUDED.verified,
            updated_at = NOW()
        """

        execute_values(cur, sql, properties)
        conn.commit()

        print(f"✅ {len(properties)} propriétés importées avec succès !")

    except Exception as e:
        conn.rollback()
        print(f"❌ Erreur import: {e}")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()

def create_sample_csv():
    """Créer un fichier CSV d'exemple"""
    sample = """id,address,city,zip,latitude,longitude,email,phone,website,rating,reviews_count,verified
prop-strasbourg-001,45 Rue de la Mésange,Strasbourg,67000,48.5734,7.7521,contact@strasbourg001.fr,03 88 11 22 33,https://strasbourg001.fr,4.8,15,true
prop-strasbourg-002,12 Boulevard de la Paix,Strasbourg,67000,48.5755,7.7453,info@strasbourg002.fr,03 88 44 55 66,https://strasbourg002.fr,4.6,12,true
prop-colmar-001,78 Rue du Marché,Colmar,68000,48.0747,7.3601,contact@colmar001.fr,03 89 20 30 40,https://colmar001.fr,4.9,18,true
prop-mulhouse-001,34 Avenue de la Paix,Mulhouse,68100,47.7412,7.5267,info@mulhouse001.fr,03 89 50 60 70,https://mulhouse001.fr,4.5,10,true
prop-lyon-001,56 Rue de la République,Lyon,69000,45.7642,4.8357,contact@lyon001.fr,04 72 10 20 30,https://lyon001.fr,4.7,14,true
"""

    with open('properties_sample.csv', 'w') as f:
        f.write(sample)

    print("✅ Fichier example properties_sample.csv créé")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        csv_file = sys.argv[1]
        print(f"📥 Importation de {csv_file}...")
        import_csv(csv_file)
    else:
        print("Utilisation: python3 import_properties.py <fichier.csv>")
        print("\nCréer un fichier CSV d'exemple...")
        create_sample_csv()
        print("\nPuis lancez: python3 import_properties.py properties_sample.csv")
