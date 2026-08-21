#!/usr/bin/env python3
"""
Publipostage - courriers de prospection sur les biens ADEME.

Principe : on adresse le LOGEMENT, pas une personne nommee. Le pli part a
"LE PROPRIETAIRE" a l'adresse exacte du DPE. Aucune donnee personnelle n'est
donc traitee, et aucun nom n'a besoin d'etre acquis.

Sortie au format AFNOR XP Z10-011 (norme postale francaise) :
    ligne 1  destinataire
    ligne 4  numero + voie
    ligne 6  CODE POSTAL + COMMUNE, en capitales, sans accent

Usage :
    python3 publipostage.py --grades F G --max-jours 21
    python3 publipostage.py --commune Strasbourg --grades F G E --sortie mailing.csv
    python3 publipostage.py --grades G --format lettres > lettres.txt
"""

import argparse
import csv
import json
import os
import sys
import unicodedata
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")

DESTINATAIRE = "LE PROPRIETAIRE"

# Ce que l'etiquette implique concretement pour le vendeur : c'est l'accroche
# du courrier, et c'est factuel (loi Climat et resilience).
CONTRAINTE = {
    "G": "logement classe G : audit energetique obligatoire a la vente, "
         "et location interdite depuis 2025",
    "F": "logement classe F : audit energetique obligatoire a la vente, "
         "et location interdite a compter de 2028",
    "E": "logement classe E : location interdite a compter de 2034",
    "D": "logement classe D",
    "C": "logement classe C",
    "B": "logement classe B",
    "A": "logement classe A",
}


def sans_accent(texte):
    """La norme postale proscrit les accents sur la ligne commune."""
    if not texte:
        return ""
    t = unicodedata.normalize("NFD", texte)
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def ligne_commune(code_postal, commune):
    """Ligne 6 AFNOR : code postal + commune en capitales sans accent."""
    return f"{code_postal or ''} {sans_accent(commune or '').upper()}".strip()


def charger(filtres):
    with open(DATA_FILE, encoding="utf-8") as f:
        biens = json.load(f)

    retenus = []
    for b in biens:
        if not b.get("address") or not b.get("city") or not b.get("zip"):
            continue  # sans adresse complete, le pli ne part pas
        if filtres.grades and b.get("grade") not in filtres.grades:
            continue
        if filtres.commune and sans_accent(b["city"]).lower() != sans_accent(filtres.commune).lower():
            continue
        if filtres.departement and b.get("departement") != filtres.departement:
            continue
        if filtres.max_jours is not None:
            jours = b.get("days_ago")
            if jours is None or jours > filtres.max_jours:
                continue
        if b.get("score", 0) < filtres.score_min:
            continue
        retenus.append(b)

    retenus.sort(key=lambda b: b.get("score", 0), reverse=True)
    if filtres.maximum:
        retenus = retenus[: filtres.maximum]
    return retenus


def export_csv(biens, chemin):
    """CSV pret pour un publipostage Word / LibreOffice / La Poste."""
    colonnes = [
        "destinataire", "adresse", "code_postal", "commune", "ligne_postale",
        "etiquette_dpe", "contrainte", "date_dpe", "anciennete_jours",
        "surface_m2", "type_batiment", "conso_kwh_m2_an", "score", "numero_dpe",
    ]
    with open(chemin, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=colonnes, delimiter=";")
        w.writeheader()
        for b in biens:
            w.writerow({
                "destinataire": DESTINATAIRE,
                "adresse": b["address"],
                "code_postal": b["zip"],
                "commune": b["city"],
                "ligne_postale": ligne_commune(b["zip"], b["city"]),
                "etiquette_dpe": b.get("grade") or "",
                "contrainte": CONTRAINTE.get(b.get("grade"), ""),
                "date_dpe": b.get("diagnostic_date") or "",
                "anciennete_jours": b.get("days_ago") if b.get("days_ago") is not None else "",
                "surface_m2": b.get("surface_m2") or "",
                "type_batiment": b.get("type_batiment") or "",
                "conso_kwh_m2_an": b.get("conso_kwh_m2_an") or "",
                "score": b.get("score") or "",
                "numero_dpe": b.get("numero_dpe") or "",
            })


def rendre_lettres(biens, agence, sortie=sys.stdout):
    """Courriers en texte, un par bien, separes par un saut de page."""
    aujourdhui = datetime.now().strftime("%d/%m/%Y")
    for b in biens:
        surface = f", {b['surface_m2']} m²" if b.get("surface_m2") else ""
        contrainte = CONTRAINTE.get(b.get("grade"), "")
        date_dpe = b.get("diagnostic_date") or ""
        try:
            date_dpe = datetime.fromisoformat(date_dpe).strftime("%d/%m/%Y")
        except ValueError:
            pass
        print(f"""{agence}

{DESTINATAIRE}
{b['address']}
{ligne_commune(b['zip'], b['city'])}

{sans_accent(b['city']).title()}, le {aujourdhui}

Objet : votre diagnostic de performance energetique

Madame, Monsieur,

Un diagnostic de performance energetique a ete etabli le
{date_dpe} pour le logement situe {b['address']}{surface},
et classe votre bien en etiquette {b.get('grade')}.

Pour information, il s'agit d'un {contrainte}.

Si vous envisagez une vente, je peux vous transmettre sans engagement une
estimation tenant compte de cette classification et des travaux
eventuellement valorisables.

Vous restant a disposition,

(signature)

--
Source du diagnostic : base publique ADEME, DPE n° {b.get('numero_dpe')}
Pour ne plus recevoir de courrier concernant ce bien, retournez ce pli
avec la mention "STOP".
""", file=sortie)
        print("\f", file=sortie)  # saut de page


def main():
    p = argparse.ArgumentParser(description="Genere un publipostage sur les biens ADEME")
    p.add_argument("--grades", nargs="+", default=["F", "G"],
                   help="etiquettes a cibler (defaut : F G)")
    p.add_argument("--commune", help="restreindre a une commune")
    p.add_argument("--departement", help="restreindre a un departement (67 / 68)")
    p.add_argument("--max-jours", type=int, default=None, dest="max_jours",
                   help="anciennete maximale du DPE, en jours")
    p.add_argument("--score-min", type=float, default=0, dest="score_min")
    p.add_argument("--max", type=int, default=None, dest="maximum")
    p.add_argument("--format", choices=["csv", "lettres"], default="csv")
    p.add_argument("--sortie", default=os.path.join(BASE_DIR, "publipostage.csv"))
    p.add_argument("--agence", default="[Votre agence]\n[Adresse]\n[Code postal Ville]")
    args = p.parse_args()

    biens = charger(args)
    if not biens:
        print("Aucun bien ne correspond aux criteres.", file=sys.stderr)
        return 1

    if args.format == "lettres":
        rendre_lettres(biens, args.agence)
        print(f"{len(biens)} courriers generes.", file=sys.stderr)
    else:
        export_csv(biens, args.sortie)
        cout = len(biens) * 1.29  # tarif lettre verte indicatif
        print(f"{len(biens)} adresses ecrites dans {os.path.basename(args.sortie)}")
        print(f"  etiquettes  : {', '.join(sorted({b.get('grade') or '?' for b in biens}))}")
        print(f"  communes    : {len({b['city'] for b in biens})}")
        if biens[0].get("days_ago") is not None:
            ages = [b["days_ago"] for b in biens if b.get("days_ago") is not None]
            print(f"  DPE etablis : il y a {min(ages)} a {max(ages)} jours")
        print(f"  cout indicatif d'affranchissement : {cout:.2f} EUR")
    return 0


if __name__ == "__main__":
    sys.exit(main())
