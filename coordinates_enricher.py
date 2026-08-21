#!/usr/bin/env python3
"""
Enrichisseur de coordonnées - BAN (Base Adresse Nationale) + INSEE
APIs publiques et gratuites
"""

import requests
import json
import psycopg2
import time

class CoordinatesEnricher:
    def __init__(self):
        self.ban_url = "https://api-adresse.data.gouv.fr"
        self.insee_url = "https://geo.api.gouv.fr"
        self.session = requests.Session()

    def geocode_address(self, address, city=None, zip_code=None):
        """
        Géocoder une adresse avec BAN
        Retourne: {latitude, longitude, insee_code, municipality}
        """
        try:
            full_address = address
            if city:
                full_address += f", {city}"
            if zip_code:
                full_address += f", {zip_code}"

            response = self.session.get(
                f"{self.ban_url}/search",
                params={"q": full_address, "limit": 1},
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                if data.get('features'):
                    feature = data['features'][0]
                    coords = feature['geometry']['coordinates']
                    props = feature['properties']

                    return {
                        'latitude': coords[1],
                        'longitude': coords[0],
                        'address': props.get('name', ''),
                        'city': props.get('city', ''),
                        'zip_code': props.get('postcode', ''),
                        'insee_code': props.get('context', {}).split(',')[2].strip() if 'context' in props else '',
                        'score': feature.get('properties', {}).get('score', 0)
                    }
        except Exception as e:
            print(f"⚠️ Erreur BAN: {e}")

        return None

    def get_insee_info(self, insee_code):
        """
        Récupérer les infos INSEE pour une commune
        """
        try:
            response = self.session.get(
                f"{self.insee_url}/communes/{insee_code}",
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    'commune': data.get('nom', ''),
                    'population': data.get('population', 0),
                    'region': data.get('region', {}),
                    'department': data.get('departement', {}),
                    'surface': data.get('surface', 0),
                    'density': data.get('population') / data.get('surface') if data.get('surface') else 0
                }
        except Exception as e:
            print(f"⚠️ Erreur INSEE: {e}")

        return None

    def get_neighborhood_info(self, latitude, longitude, radius_km=1):
        """
        Récupérer les infos du quartier
        """
        try:
            # Chercher les lieux proches
            response = self.session.get(
                f"{self.insee_url}/communes",
                params={
                    "lat": latitude,
                    "lon": longitude,
                    "limit": 1
                },
                timeout=10
            )

            if response.status_code == 200:
                communes = response.json()
                if communes:
                    return self.get_insee_info(communes[0]['code'])
        except Exception as e:
            print(f"⚠️ Erreur quartier: {e}")

        return None

    def enrich_property(self, property_id, address, city=None, zip_code=None):
        """
        Enrichir une propriété avec ses coordonnées
        """
        print(f"🧩 Enrichissement: {address}...")

        # Géocoder
        geo_data = self.geocode_address(address, city, zip_code)
        if not geo_data:
            print(f"⚠️ Impossible de géocoder: {address}")
            return None

        # Récupérer infos INSEE
        insee_data = self.get_insee_info(geo_data.get('insee_code'))

        # Récupérer infos quartier
        neighborhood = self.get_neighborhood_info(
            geo_data['latitude'],
            geo_data['longitude']
        )

        return {
            'property_id': property_id,
            'address': geo_data.get('address'),
            'city': geo_data.get('city'),
            'zip_code': geo_data.get('zip_code'),
            'latitude': geo_data['latitude'],
            'longitude': geo_data['longitude'],
            'insee_code': geo_data.get('insee_code'),
            'geocoding_score': geo_data.get('score'),
            'population': insee_data.get('population') if insee_data else 0,
            'density': insee_data.get('density') if insee_data else 0,
            'region': insee_data.get('region', {}).get('nom') if insee_data else '',
        }

    def batch_enrich(self, limit=500):
        """
        Enrichir en masse toutes les propriétés
        """
        conn = psycopg2.connect(
            host="localhost",
            database="dpe_radar",
            user="geraldhenry"
        )
        cur = conn.cursor()

        try:
            print(f"📍 Enrichissement en masse ({limit} propriétés)...\n")

            cur.execute("""
            SELECT id, address, city, code_postal
            FROM therapeutes
            WHERE latitude IS NULL OR latitude = 0
            LIMIT %s
            """, (limit,))

            properties = cur.fetchall()
            count = 0

            for prop_id, address, city, zip_code in properties:
                enriched = self.enrich_property(prop_id, address, city, zip_code)

                if enriched:
                    cur.execute("""
                    UPDATE therapeutes
                    SET
                        latitude = %s,
                        longitude = %s,
                        city = %s,
                        code_postal = %s
                    WHERE id = %s
                    """, (
                        enriched['latitude'],
                        enriched['longitude'],
                        enriched.get('city', city),
                        enriched.get('zip_code', zip_code),
                        prop_id
                    ))

                    count += 1
                    if count % 50 == 0:
                        conn.commit()
                        print(f"✅ {count}/{len(properties)} propriétés enrichies")
                        time.sleep(1)  # Rate limit respectueux

            conn.commit()
            print(f"\n✅ {count} propriétés enrichies au total")

        except Exception as e:
            conn.rollback()
            print(f"❌ Erreur: {e}")
        finally:
            cur.close()
            conn.close()

if __name__ == "__main__":
    print("🚀 DPE Radar AI - Coordinates Enricher\n")

    enricher = CoordinatesEnricher()

    # Test avec une adresse
    print("Test: Géocodage d'une adresse")
    result = enricher.geocode_address("45 Rue de la Paix", "Strasbourg", "67000")
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))

    print("\n" + "="*60)
    print("Pour enrichir toutes les propriétés:")
    print("  python3 coordinates_enricher.py")
    print("\nOu pour enrichir 100 propriétés:")
    print("  python3 coordinates_enricher.py --limit 100")

    # Lancer l'enrichissement si demandé
    import sys
    if len(sys.argv) > 1:
        enricher.batch_enrich(500)
