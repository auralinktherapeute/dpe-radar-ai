#!/usr/bin/env python3
"""
Scraper immobilier - Récupère les annonces réelles avec contacts
Utilise Obscura (headless browser Rust) pour le scraping
"""

import requests
import json
import re
import psycopg2
from datetime import datetime
import time
import asyncio

class PropertyScraper:
    def __init__(self, obscura_cdp_url="http://localhost:9222"):
        self.cdp_url = obscura_cdp_url
        self.session = requests.Session()
        self.user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

    def create_page(self):
        """Créer une page Obscura CDP"""
        try:
            response = self.session.post(f"{self.cdp_url}/json/new")
            if response.status_code == 200:
                return response.json()
            return None
        except Exception as e:
            print(f"❌ Erreur création page: {e}")
            return None

    def navigate(self, page_id, url):
        """Naviguer vers une URL"""
        try:
            self.session.post(
                f"{self.cdp_url}/json/pageCommand",
                json={
                    "id": page_id,
                    "command": "Page.navigate",
                    "url": url
                }
            )
            time.sleep(3)  # Attendre le chargement
            return True
        except Exception as e:
            print(f"❌ Erreur navigation: {e}")
            return False

    def extract_content(self, page_id):
        """Extraire le contenu HTML d'une page"""
        try:
            response = self.session.post(
                f"{self.cdp_url}/json/pageCommand",
                json={
                    "id": page_id,
                    "command": "Runtime.evaluate",
                    "expression": "document.documentElement.outerHTML",
                    "returnByValue": True
                }
            )
            data = response.json()
            return data.get("result", {}).get("value", "")
        except Exception as e:
            print(f"❌ Erreur extraction: {e}")
            return ""

    def parse_seloger(self, html):
        """Parser les annonces SeLoger"""
        properties = []

        # Extraire les annonces (CSS selectors de SeLoger)
        try:
            # Extraire emails et téléphones avec regex
            email_pattern = r'[\w\.-]+@[\w\.-]+\.\w+'
            phone_pattern = r'(?:0|\+33)[1-9](?:[0-9]{8}|[0-9] [0-9]{3} [0-9]{2} [0-9]{2})'

            emails = re.findall(email_pattern, html)
            phones = re.findall(phone_pattern, html)

            # Extraire prix
            price_pattern = r'(\d+(?:\s?\d{3})*)\s*€'
            prices = re.findall(price_pattern, html)

            # Extraire adresses
            address_pattern = r'(\d+\s+[A-Za-z\s,]+\d{5})'
            addresses = re.findall(address_pattern, html)

            for i, addr in enumerate(addresses[:5]):  # Max 5 annonces
                properties.append({
                    'address': addr,
                    'email': emails[i] if i < len(emails) else '',
                    'phone': phones[i] if i < len(phones) else '',
                    'price': int(prices[i].replace(' ', '')) if i < len(prices) else 0,
                    'source': 'seloger',
                    'url': ''
                })
        except Exception as e:
            print(f"⚠️ Erreur parsing SeLoger: {e}")

        return properties

    def parse_leboncoin(self, html):
        """Parser les annonces LeBonCoin"""
        properties = []

        try:
            # Mêmes patterns pour LeBonCoin
            email_pattern = r'[\w\.-]+@[\w\.-]+\.\w+'
            phone_pattern = r'(?:0|\+33)[1-9](?:[0-9]{8}|[0-9] [0-9]{3} [0-9]{2} [0-9]{2})'
            price_pattern = r'(\d+(?:\s?\d{3})*)\s*€'

            emails = re.findall(email_pattern, html)
            phones = re.findall(phone_pattern, html)
            prices = re.findall(price_pattern, html)

            for i in range(min(5, len(emails))):
                properties.append({
                    'email': emails[i],
                    'phone': phones[i] if i < len(phones) else '',
                    'price': int(prices[i].replace(' ', '')) if i < len(prices) else 0,
                    'source': 'leboncoin',
                })
        except Exception as e:
            print(f"⚠️ Erreur parsing LeBonCoin: {e}")

        return properties

    def scrape_seloger(self, city, min_price=0, max_price=500000):
        """Scraper SeLoger pour une ville"""
        try:
            print(f"🔍 Scraping SeLoger pour {city}...")

            page = self.create_page()
            if not page:
                print("❌ Impossible de créer une page Obscura")
                return []

            page_id = page.get('id')
            url = f"https://www.seloger.com/immobilier/search.htm?city={city}&priceMin={min_price}&priceMax={max_price}"

            if not self.navigate(page_id, url):
                return []

            html = self.extract_content(page_id)
            properties = self.parse_seloger(html)

            print(f"✅ {len(properties)} annonces trouvées sur SeLoger")

            # Fermer la page
            self.session.post(f"{self.cdp_url}/json/close", json={"id": page_id})

            return properties

        except Exception as e:
            print(f"❌ Erreur scrape SeLoger: {e}")
            return []

    def scrape_leboncoin(self, city, category="ventes_immobilieres"):
        """Scraper LeBonCoin pour une ville"""
        try:
            print(f"🔍 Scraping LeBonCoin pour {city}...")

            page = self.create_page()
            if not page:
                return []

            page_id = page.get('id')
            url = f"https://www.leboncoin.fr/search?category={category}&region={city}"

            if not self.navigate(page_id, url):
                return []

            html = self.extract_content(page_id)
            properties = self.parse_leboncoin(html)

            print(f"✅ {len(properties)} annonces trouvées sur LeBonCoin")

            self.session.post(f"{self.cdp_url}/json/close", json={"id": page_id})

            return properties

        except Exception as e:
            print(f"❌ Erreur scrape LeBonCoin: {e}")
            return []

    def save_to_db(self, properties):
        """Sauvegarder les propriétés en base de données"""
        try:
            conn = psycopg2.connect(
                host="localhost",
                database="dpe_radar",
                user="geraldhenry"
            )
            cur = conn.cursor()

            for prop in properties:
                cur.execute("""
                INSERT INTO market_signals (property_id, signal_type, data, created_at)
                VALUES (%s, %s, %s, NOW())
                """, (
                    prop.get('address', ''),
                    'annonce_' + prop.get('source', ''),
                    json.dumps(prop)
                ))

            conn.commit()
            print(f"✅ {len(properties)} propriétés sauvegardées")

        except Exception as e:
            print(f"❌ Erreur sauvegarde: {e}")
        finally:
            if conn:
                cur.close()
                conn.close()

if __name__ == "__main__":
    print("🚀 DPE Radar AI - Property Scraper\n")

    scraper = PropertyScraper()

    # Vérifier que Obscura CDP est disponible
    print("⏳ Vérification Obscura CDP...")
    try:
        resp = scraper.session.get(f"{scraper.cdp_url}/json/version", timeout=5)
        if resp.status_code == 200:
            print("✅ Obscura CDP prêt\n")
        else:
            print("❌ Obscura CDP non disponible")
            print("   Lance: ./target/release/dpe-radar-workers")
            print("   Ou: cd /tmp/obscura && cargo run --release --bin obscura-cli -- --remote-debugging-port=9222")
    except:
        print("❌ Obscura CDP non accessible sur localhost:9222")
        print("   Lance d'abord Obscura CDP !")

    print("\nUsage:")
    print("  python3 property_scraper.py seloger strasbourg")
    print("  python3 property_scraper.py leboncoin strasbourg")
