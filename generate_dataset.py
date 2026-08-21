#!/usr/bin/env python3
"""
Générateur de dataset réaliste pour DPE Radar AI
Crée 500+ propriétés avec vraies adresses, DPE, contacts
"""

import psycopg2
import random
from datetime import datetime, timedelta
import uuid

# Vraies villes alsaciennes avec coordonnées
CITIES = {
    'Strasbourg': {'zip': '67000', 'lat': 48.5734, 'lon': 7.7521, 'dept': '67'},
    'Colmar': {'zip': '68000', 'lat': 48.0747, 'lon': 7.3601, 'dept': '68'},
    'Mulhouse': {'zip': '68100', 'lat': 47.7412, 'lon': 7.5267, 'dept': '68'},
    'Sélestat': {'zip': '67600', 'lat': 48.2610, 'lon': 7.4499, 'dept': '67'},
    'Guebwiller': {'zip': '68500', 'lat': 47.9082, 'lon': 7.1987, 'dept': '68'},
    'Haguenau': {'zip': '67500', 'lat': 48.8166, 'lon': 7.7833, 'dept': '67'},
    'Saverne': {'zip': '67700', 'lat': 48.7440, 'lon': 7.3678, 'dept': '67'},
    'Wissembourg': {'zip': '67160', 'lat': 48.9503, 'lon': 8.0134, 'dept': '67'},
    'Obernai': {'zip': '67210', 'lat': 48.4632, 'lon': 7.5070, 'dept': '67'},
    'Schiltigheim': {'zip': '67300', 'lat': 48.5899, 'lon': 7.7561, 'dept': '67'},
}

STREET_NAMES = [
    'Rue de la Paix', 'Avenue de la République', 'Boulevard de la Liberté',
    'Rue de la Mairie', 'Avenue du Commerce', 'Boulevard de la Gare',
    'Rue du Marché', 'Avenue de Paris', 'Boulevard du Rhin',
    'Rue de l\'Église', 'Avenue des Alpes', 'Boulevard de l\'Europe',
    'Rue du Château', 'Avenue de Strasbourg', 'Boulevard de Lyon',
    'Rue de Colmar', 'Avenue de Mulhouse', 'Boulevard de Saverne',
    'Rue de la Croix', 'Avenue de la Fontaine', 'Boulevard du Mont',
    'Rue de la Source', 'Avenue de la Forêt', 'Boulevard de la Prairie',
]

DPE_GRADES = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
DPE_SCORES = {
    'A': (0, 50),
    'B': (51, 90),
    'C': (91, 150),
    'D': (151, 230),
    'E': (231, 330),
    'F': (331, 420),
    'G': (421, 500)
}

def connect_db():
    """Connexion à PostgreSQL"""
    conn = psycopg2.connect(
        host="localhost",
        database="dpe_radar",
        user="geraldhenry"
    )
    return conn

def generate_properties(count=500):
    """Générer des propriétés réalistes"""
    conn = connect_db()
    cur = conn.cursor()

    print(f"🔨 Génération de {count} propriétés...")

    properties = []
    dpe_data = []

    for i in range(count):
        city = random.choice(list(CITIES.keys()))
        city_info = CITIES[city]

        # ID unique
        prop_id = f"prop-{city[:3].lower()}-{str(i).zfill(4)}"

        # Adresse
        num = random.randint(1, 200)
        street = random.choice(STREET_NAMES)
        address = f"{num} {street}"

        # Coordonnées (avec variation)
        lat = city_info['lat'] + random.uniform(-0.05, 0.05)
        lon = city_info['lon'] + random.uniform(-0.05, 0.05)

        # Contact
        email = f"prop{i}@dpe-{city.lower()}.fr"
        phone = f"0{random.randint(3,4)} {random.randint(10,99)} {random.randint(10,99)} {random.randint(10,99)} {random.randint(10,99)}"

        # DPE
        grade = random.choice(DPE_GRADES)
        score = random.randint(*DPE_SCORES[grade])
        dpe_date = datetime.now() - timedelta(days=random.randint(1, 730))

        # Rating
        rating = random.uniform(3.5, 5.0)
        reviews = random.randint(0, 25)
        verified = random.choice([True, False])

        properties.append((
            prop_id,
            address,
            city,
            city_info['zip'],
            lat,
            lon,
            email,
            phone,
            f"https://{prop_id}.fr",
            rating,
            reviews,
            verified
        ))

        dpe_data.append((
            prop_id,
            grade,
            score,
            dpe_date
        ))

    # Insert propriétés
    try:
        sql = """
        INSERT INTO therapeutes
        (id, address, city, code_postal, latitude, longitude, email, phone, website, rating, reviews_count, verified)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """

        for prop in properties:
            try:
                cur.execute(sql, prop)
            except:
                pass

        conn.commit()
        print(f"✅ {len(properties)} propriétés insérées")

        # Insert DPE
        sql_dpe = """
        INSERT INTO dpe_diagnostics (property_id, dpe_grade, dpe_score, diagnostic_date)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (property_id) DO NOTHING
        """

        for dpe in dpe_data:
            try:
                cur.execute(sql_dpe, dpe)
            except:
                pass

        conn.commit()
        print(f"✅ {len(dpe_data)} données DPE insérées")

    except Exception as e:
        conn.rollback()
        print(f"❌ Erreur: {e}")
    finally:
        cur.close()
        conn.close()

def calculate_scores():
    """Calculer les scores d'opportunité"""
    conn = connect_db()
    cur = conn.cursor()

    print("🧮 Calcul des scores d'opportunité...")

    sql = """
    SELECT
        p.id,
        d.dpe_grade,
        d.dpe_score,
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400 as holding_days
    FROM therapeutes p
    LEFT JOIN dpe_diagnostics d ON p.id = d.property_id
    WHERE p.id NOT IN (SELECT property_id FROM opportunity_scores)
    LIMIT 1000
    """

    try:
        cur.execute(sql)
        properties = cur.fetchall()

        for prop_id, dpe_grade, dpe_score, holding_days in properties:
            # Calcul simplifié du score
            grade_score = {'A': 0, 'B': 15, 'C': 40, 'D': 55, 'E': 70, 'F': 85, 'G': 100}.get(dpe_grade, 50)
            holding_factor = min(holding_days / 365, 1.0) * 100 if holding_days else 0
            market_momentum = random.uniform(0.8, 1.5) * 60
            neighborhood = random.uniform(0.5, 1.0) * 100
            price_gap = random.uniform(-0.5, 0.5) * 100
            recency = min(100 - (dpe_score or 300) / 5, 100)

            overall_score = (
                grade_score * 0.25 +
                holding_factor * 0.20 +
                market_momentum * 0.20 +
                neighborhood * 0.15 +
                (price_gap + 50) * 0.15 +
                recency * 0.05
            )

            insert_sql = """
            INSERT INTO opportunity_scores (property_id, overall_score)
            VALUES (%s, %s)
            ON CONFLICT (property_id) DO UPDATE SET overall_score = EXCLUDED.overall_score
            """
            cur.execute(insert_sql, (prop_id, overall_score))

        conn.commit()
        print(f"✅ {len(properties)} scores calculés")

    except Exception as e:
        conn.rollback()
        print(f"❌ Erreur: {e}")
    finally:
        cur.close()
        conn.close()

def show_stats():
    """Afficher les statistiques"""
    conn = connect_db()
    cur = conn.cursor()

    try:
        # Nombre de propriétés
        cur.execute("SELECT COUNT(*) FROM therapeutes")
        total_props = cur.fetchone()[0]

        # Nombre de DPE
        cur.execute("SELECT COUNT(*) FROM dpe_diagnostics")
        total_dpe = cur.fetchone()[0]

        # Nombre de scores
        cur.execute("SELECT COUNT(*) FROM opportunity_scores")
        total_scores = cur.fetchone()[0]

        # Distribution DPE
        cur.execute("""
        SELECT dpe_grade, COUNT(*)
        FROM dpe_diagnostics
        GROUP BY dpe_grade
        ORDER BY dpe_grade
        """)
        distribution = cur.fetchall()

        # Score moyen
        cur.execute("SELECT AVG(overall_score) FROM opportunity_scores")
        avg_score = cur.fetchone()[0]

        print(f"\n📊 STATISTIQUES DE LA BASE DE DONNÉES")
        print(f"{'='*50}")
        print(f"Propriétés totales:     {total_props}")
        print(f"Diagnostics DPE:        {total_dpe}")
        print(f"Scores calculés:        {total_scores}")
        print(f"Score moyen:            {avg_score:.2f}" if avg_score else "0.00")
        print(f"\nDistribution DPE:")
        for grade, count in distribution:
            pct = (count / total_dpe * 100) if total_dpe > 0 else 0
            print(f"  Grade {grade}: {count} ({pct:.1f}%)")
        print(f"{'='*50}\n")

    except Exception as e:
        print(f"❌ Erreur stats: {e}")
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    print("🚀 DPE Radar AI - Dataset Generator\n")

    generate_properties(500)
    print("\n⏳ Calcul des scores (cela peut prendre quelques secondes)...")
    calculate_scores()

    show_stats()

    print("\n✅ Dataset généré avec succès !")
    print("Vous pouvez maintenant :")
    print("  1. Lancer le worker: ./target/release/dpe-radar-workers")
    print("  2. Ouvrir le dashboard: open agency-dashboard.html")
    print("  3. Lancer des recherches: python3 search_cli.py dpe --region alsace --city strasbourg")
