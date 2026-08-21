#!/usr/bin/env python3
"""
Connecteur ADEME - donnees DPE reelles et officielles.

Source : https://data.ademe.fr/datasets/dpe03existant
         API ouverte, sans cle, 15,4 millions de DPE de logements existants.

Ce que l'ADEME fournit reellement :
  - adresse geocodee BAN + coordonnees GPS
  - etiquette DPE (A-G) et etiquette GES
  - date d'etablissement du DPE  <- le signal de vente
  - surface, type de batiment, annee de construction, consommations

Ce que l'ADEME ne fournit PAS : nom, email ou telephone du proprietaire.
Ces champs n'existent pas dans le jeu de donnees (RGPD). Le connecteur
laisse donc owner_email / owner_phone a None : a chaque source de les
remplir, aucune valeur n'est inventee ici.

Usage :
    python3 ademe_connector.py --departements 67 68 --depuis 2026-06-01
    python3 ademe_connector.py --departements 67 --depuis 2026-08-01 --max 500
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

API = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CHAMPS = [
    "numero_dpe", "adresse_ban", "nom_commune_ban", "code_postal_ban",
    "code_departement_ban", "etiquette_dpe", "etiquette_ges",
    "date_etablissement_dpe", "_geopoint", "surface_habitable_logement",
    "type_batiment", "annee_construction", "conso_5_usages_par_m2_ep",
    "emission_ges_5_usages_par_m2", "periode_construction",
]

# Un DPE F ou G contraint le vendeur (audit energetique obligatoire, gel des
# loyers) : c'est le signal le plus fort. La recence pese ensuite, car un DPE
# fraichement etabli precede generalement la mise en vente de 1 a 3 mois.
POIDS_ETIQUETTE = {"G": 100, "F": 88, "E": 68, "D": 50, "C": 32, "B": 18, "A": 10}


def http_get_json(url, timeout=60, tentatives=4):
    """GET avec retry exponentiel : l'API ADEME renvoie parfois 429/502."""
    for essai in range(tentatives):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dpe-radar-ai/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if essai == tentatives - 1:
                raise
            attente = 2 ** essai
            print(f"    ! {type(e).__name__}, nouvelle tentative dans {attente}s", flush=True)
            time.sleep(attente)


def recuperer(departements, depuis, maximum=None, taille_page=1000):
    """Pagine l'API ADEME et renvoie les DPE bruts."""
    filtre = " AND ".join([
        "code_departement_ban:(" + " OR ".join(departements) + ")",
        f"date_etablissement_dpe:[{depuis} TO *]",
    ])
    params = {
        "qs": filtre,
        "size": taille_page,
        "select": ",".join(CHAMPS),
        "sort": "-date_etablissement_dpe",
    }
    url = API + "?" + urllib.parse.urlencode(params)

    lignes, page = [], 0
    while url:
        page += 1
        data = http_get_json(url)
        if page == 1:
            print(f"  {data.get('total', 0):,} DPE correspondent au filtre")
        lignes.extend(data.get("results", []))
        print(f"  page {page} -> {len(lignes)} DPE recuperes", flush=True)

        if maximum and len(lignes) >= maximum:
            lignes = lignes[:maximum]
            break
        url = data.get("next")
        if url:
            time.sleep(0.3)  # on reste courtois avec l'API publique
    return lignes


def score_opportunite(etiquette, jours_ecoules, surface):
    """Score 0-100. Uniquement derive de donnees ADEME reelles."""
    score = POIDS_ETIQUETTE.get(etiquette, 40) * 0.60

    # Recence : maximum dans les 30 premiers jours, decroit sur 180 jours.
    if jours_ecoules is None:
        recence = 0
    elif jours_ecoules <= 30:
        recence = 100
    elif jours_ecoules >= 180:
        recence = 0
    else:
        recence = 100 * (180 - jours_ecoules) / 150
    score += recence * 0.30

    # Les grandes surfaces representent un enjeu de travaux plus lourd.
    if surface:
        score += min(surface / 200, 1.0) * 100 * 0.10

    return round(min(score, 100), 1)


def normaliser(brut):
    """Convertit un enregistrement ADEME au format du dashboard."""
    lat = lon = None
    if brut.get("_geopoint"):
        try:
            lat, lon = (float(x) for x in brut["_geopoint"].split(","))
        except (ValueError, TypeError):
            pass

    date_dpe = brut.get("date_etablissement_dpe")
    jours = None
    if date_dpe:
        try:
            jours = (datetime.now() - datetime.fromisoformat(date_dpe)).days
        except ValueError:
            pass

    surface = brut.get("surface_habitable_logement")
    etiquette = brut.get("etiquette_dpe")
    commune = brut.get("nom_commune_ban")

    adresse = brut.get("adresse_ban") or ""
    # adresse_ban contient "12 Rue X 67000 Strasbourg" : on retire le suffixe
    # code postal + commune pour ne garder que la voie.
    if commune and adresse:
        for suffixe in (f" {brut.get('code_postal_ban')} {commune}", f" {commune}"):
            if suffixe and adresse.endswith(suffixe):
                adresse = adresse[: -len(suffixe)]
                break

    return {
        "id": brut.get("numero_dpe"),
        "numero_dpe": brut.get("numero_dpe"),
        "address": adresse.strip(),
        "city": commune,
        "zip": brut.get("code_postal_ban"),
        "departement": brut.get("code_departement_ban"),
        "latitude": lat,
        "longitude": lon,
        "grade": etiquette,
        "grade_ges": brut.get("etiquette_ges"),
        "diagnostic_date": date_dpe,
        "days_ago": jours,
        "surface_m2": surface,
        "type_batiment": brut.get("type_batiment"),
        "annee_construction": brut.get("annee_construction"),
        "conso_kwh_m2_an": brut.get("conso_5_usages_par_m2_ep"),
        "ges_kg_m2_an": brut.get("emission_ges_5_usages_par_m2"),
        "score": score_opportunite(etiquette, jours, surface),
        # L'ADEME ne diffuse aucune coordonnee de proprietaire.
        "owner_name": None,
        "email": None,
        "phone": None,
        "source": "ADEME dpe03existant",
    }


def main():
    p = argparse.ArgumentParser(description="Importe des DPE reels depuis l'ADEME")
    p.add_argument("--departements", nargs="+", default=["67", "68"])
    p.add_argument("--depuis", default=(datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d"))
    p.add_argument("--max", type=int, default=None, dest="maximum")
    p.add_argument("--sortie", default=os.path.join(BASE_DIR, "data.json"))
    args = p.parse_args()

    print(f"ADEME - departements {', '.join(args.departements)}, DPE depuis {args.depuis}")
    brut = recuperer(args.departements, args.depuis, args.maximum)
    if not brut:
        print("Aucun DPE recupere.")
        return 1

    biens = [normaliser(b) for b in brut]
    biens = [b for b in biens if b["address"] and b["city"]]
    # Un meme logement peut avoir plusieurs DPE : on garde le plus recent.
    par_adresse = {}
    for b in sorted(biens, key=lambda x: x["diagnostic_date"] or "", reverse=True):
        cle = (b["address"].lower(), b["city"].lower())
        par_adresse.setdefault(cle, b)
    biens = sorted(par_adresse.values(), key=lambda x: x["score"], reverse=True)

    with open(args.sortie, "w", encoding="utf-8") as f:
        json.dump(biens, f, ensure_ascii=False, indent=1)

    geo = sum(1 for b in biens if b["latitude"])
    print(f"\n{len(biens)} biens ecrits dans {os.path.basename(args.sortie)}")
    print(f"  geocodes    : {geo}/{len(biens)}")
    print(f"  communes    : {len({b['city'] for b in biens})}")
    print(f"  periode DPE : {min(b['diagnostic_date'] for b in biens)} -> "
          f"{max(b['diagnostic_date'] for b in biens)}")
    print(f"  contacts    : 0 (absents du jeu de donnees ADEME)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
