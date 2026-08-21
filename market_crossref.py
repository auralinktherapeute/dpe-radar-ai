#!/usr/bin/env python3
"""
Recoupement marche - identifie les biens ADEME DEJA en vente pour les ecarter.

Strategie : un bien present sur un portail est deja mandate, l'affaire est
prise. La valeur est donc dans la SOUSTRACTION : on retire du fichier ADEME
tout ce qui apparait sur le marche, et ce qui reste est le gisement vierge
(DPE recent, aucune annonce) - le proprietaire n'a pas encore choisi d'agence.

Appariement : les annonces ne publient presque jamais la rue. Elles publient
en revanche la surface et l'etiquette DPE, obligatoire depuis 2021. La
signature retenue est donc (commune, surface, etiquette, type), pas l'adresse.

Aucune donnee personnelle n'est collectee : on ne retient qu'un booleen
"ce bien est-il visible sur le marche".

Sources :
  --source csv fichier.csv     tout export d'annonces dont vous avez l'usage
                               (votre portail pro, votre flux, un export MLS)
  --source obscura             collecte via Obscura CDP, sous reserve du
                               robots.txt du site, verifie automatiquement

Usage :
    python3 market_crossref.py --source csv annonces.csv
    python3 market_crossref.py --source obscura --site leboncoin --commune Strasbourg
    python3 market_crossref.py --rapport
"""

import argparse
import csv
import json
import os
import sys
import time
import re
import unicodedata
import urllib.parse
import urllib.request
import urllib.robotparser
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")
CDP_URL = os.environ.get("OBSCURA_CDP", "http://localhost:9222")

UA = "dpe-radar-ai/1.0 (+recoupement marche)"

SITES = {
    "leboncoin": {
        "base": "https://www.leboncoin.fr",
        "recherche": "/recherche?category=9&locations={commune}",
    },
    "seloger": {
        "base": "https://www.seloger.com",
        "recherche": "/classified-search?distributionTypes=Buy&locations={commune}",
    },
}


# --------------------------------------------------------------- normalisation

def sans_accent(t):
    if not t:
        return ""
    t = unicodedata.normalize("NFD", t)
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def cle_commune(nom):
    return "".join(c for c in sans_accent(nom or "").lower() if c.isalnum())


def _nombre(v):
    """Convertit '422,7 kWh' -> 422.7 ; None si non exploitable."""
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", ".").split()[0])
    except (ValueError, IndexError):
        return None


def signature(commune, surface, grade, type_bat=None):
    """Signature d'appariement. La surface est arrondie pour absorber les
    ecarts de mesure entre le diagnostiqueur et l'annonce."""
    if surface is None:
        return None
    return (cle_commune(commune), int(round(float(surface))), (grade or "").upper(),
            (type_bat or "").lower() or None)


# --------------------------------------------------------------- index marche

class IndexMarche:
    """Indexe les annonces par signature, avec tolerance sur la surface."""

    def __init__(self, tolerance_m2=2):
        self.tolerance = tolerance_m2
        self._par_cle = defaultdict(list)
        self.total = 0

    def ajouter(self, commune, surface, grade, type_bat=None, ref=None, conso=None):
        sig = signature(commune, surface, grade, type_bat)
        if not sig:
            return
        self._par_cle[(sig[0], sig[2])].append({
            "surface": sig[1], "type": sig[3], "ref": ref,
            "conso": _nombre(conso),
        })
        self.total += 1

    def chercher(self, commune, surface, grade, type_bat=None, conso=None):
        """Renvoie (en_vente, confiance, reference) pour un bien ADEME.

        La consommation en kWh/m2/an porte l'unicite de la signature de 82%
        a 99% sur le jeu alsacien ; les annonces doivent l'afficher depuis
        2021. Aucun appariement n'est pour autant certain : sans l'adresse,
        deux logements identiques d'une meme commune restent confondus. La
        confiance maximale est donc "forte", jamais "certaine".
        """
        sig = signature(commune, surface, grade, type_bat)
        if not sig:
            return False, None, None
        conso_ademe = _nombre(conso)

        candidats = self._par_cle.get((sig[0], sig[2]), [])
        meilleur = None
        for c in candidats:
            ecart = abs(c["surface"] - sig[1])
            if ecart > self.tolerance:
                continue

            # Consommation connue des deux cotes : elle tranche.
            if conso_ademe is not None and c["conso"] is not None:
                if abs(c["conso"] - conso_ademe) > max(5, 0.05 * conso_ademe):
                    continue  # meme surface et meme lettre, mais autre logement
                return True, "forte", c["ref"]

            if ecart == 0 and c["type"] and sig[3] and c["type"] == sig[3]:
                if meilleur is None or meilleur[0] > (0, 0):
                    meilleur = ((0, 0), c, "haute")
                continue
            rang = (0 if ecart == 0 else 1, ecart)
            if meilleur is None or rang < meilleur[0]:
                meilleur = (rang, c, "haute" if ecart == 0 else "moyenne")

        if meilleur:
            return True, meilleur[2], meilleur[1]["ref"]
        return False, None, None


# --------------------------------------------------------------- sources

def charger_csv(chemin, index):
    """Charge un export d'annonces. Colonnes reconnues (insensible a la casse) :
    commune/ville, surface, dpe/etiquette, type, reference/url."""
    alias = {
        "commune": {"commune", "ville", "city", "localite"},
        "surface": {"surface", "surface_m2", "m2", "superficie"},
        "grade": {"dpe", "etiquette", "etiquette_dpe", "grade", "classe_energie"},
        "type": {"type", "type_bien", "type_batiment", "categorie"},
        "ref": {"reference", "ref", "url", "lien", "id"},
        "conso": {"conso", "consommation", "conso_kwh_m2_an", "kwh", "energie_kwh"},
    }
    with open(chemin, encoding="utf-8-sig", newline="") as f:
        echantillon = f.read(4096)
        f.seek(0)
        try:
            dialecte = csv.Sniffer().sniff(echantillon, delimiters=";,\t")
        except csv.Error:
            dialecte = csv.excel
            dialecte.delimiter = ";"
        lecteur = csv.DictReader(f, dialect=dialecte)

        entetes = {h.lower().strip(): h for h in (lecteur.fieldnames or [])}
        mapping = {}
        for champ, noms in alias.items():
            for n in noms:
                if n in entetes:
                    mapping[champ] = entetes[n]
                    break

        manquants = [c for c in ("commune", "surface", "grade") if c not in mapping]
        if manquants:
            print(f"  ! colonnes introuvables : {', '.join(manquants)}", file=sys.stderr)
            print(f"    entetes du fichier : {', '.join(entetes)}", file=sys.stderr)
            return 0

        n = 0
        for ligne in lecteur:
            try:
                surface = float(str(ligne[mapping["surface"]]).replace(",", ".").split()[0])
            except (ValueError, KeyError, IndexError):
                continue
            index.ajouter(
                ligne.get(mapping["commune"]), surface, ligne.get(mapping["grade"]),
                ligne.get(mapping.get("type", ""), None) if "type" in mapping else None,
                ligne.get(mapping.get("ref", ""), None) if "ref" in mapping else None,
                ligne.get(mapping.get("conso", ""), None) if "conso" in mapping else None,
            )
            n += 1
        return n


def robots_autorise(base, chemin):
    """Verifie le robots.txt du site. Un refus n'est pas contourne."""
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(urllib.parse.urljoin(base, "/robots.txt"))
    try:
        rp.read()
    except Exception as e:
        print(f"  ! robots.txt illisible ({e}) : on s'abstient", file=sys.stderr)
        return False
    return rp.can_fetch(UA, urllib.parse.urljoin(base, chemin))


FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape"


def _firecrawl(url, cle, attente=4000):
    """Recupere une page en markdown via Firecrawl."""
    import urllib.request
    corps = json.dumps({"url": url, "formats": ["markdown"],
                        "waitFor": attente}).encode("utf-8")
    req = urllib.request.Request(
        FIRECRAWL_API, data=corps, method="POST",
        headers={"Authorization": f"Bearer {cle}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.loads(r.read().decode("utf-8"))
    if not d.get("success"):
        raise RuntimeError(str(d.get("error"))[:200])
    return (d.get("data") or {}).get("markdown", "")


def charger_firecrawl(site, commune, index, max_annonces=25):
    """Collecte via Firecrawl, en deux temps.

    La page de recherche ne porte ni etiquette DPE ni consommation : elle ne
    donne que type, pieces et surface, ce qui plafonne l'unicite de la
    signature a 70%. L'etiquette n'apparait que sur la page de l'annonce.
    On paie donc un credit par annonce : d'ou le plafond max_annonces.
    """
    cle = os.environ.get("FIRECRAWL_API_KEY", "")
    if not cle:
        print("  ! FIRECRAWL_API_KEY absente de l'environnement", file=sys.stderr)
        return 0

    conf = SITES.get(site)
    if not conf:
        print(f"  ! site inconnu : {site}", file=sys.stderr)
        return 0
    chemin = conf["recherche"].format(commune=urllib.parse.quote(commune))
    if not robots_autorise(conf["base"], chemin):
        print(f"  ! {site} : robots.txt interdit {chemin.split('?')[0]}", file=sys.stderr)
        return 0

    print(f"  page de recherche {site} / {commune}")
    try:
        md = _firecrawl(conf["base"] + chemin, cle)
    except Exception as e:
        print(f"  ! recherche impossible : {e}", file=sys.stderr)
        return 0

    liens = re.findall(r"https://www\.leboncoin\.fr/ad/[^)\s]+", md)
    liens = list(dict.fromkeys(liens))[:max_annonces]
    print(f"  {len(liens)} annonces a ouvrir (1 credit chacune)")

    n = 0
    for i, lien in enumerate(liens, 1):
        try:
            page = _firecrawl(lien, cle)
        except Exception as e:
            print(f"    {i}/{len(liens)} echec : {e}", file=sys.stderr)
            continue
        grade = re.search(r"(?:DPE|classe[ _]énergie)\D{0,40}\b([A-G])\b", page, re.I)
        surf = re.search(r"(\d+[.,]?\d*)\s?m²", page)
        if not (grade and surf):
            continue
        index.ajouter(commune, float(surf.group(1).replace(",", ".")),
                      grade.group(1), None, lien, None)
        n += 1
        time.sleep(0.5)
    print(f"  {n} annonces exploitables indexees")
    return n


def charger_obscura(site, commune, index):
    """Collecte via Obscura CDP, uniquement si le robots.txt l'autorise."""
    conf = SITES.get(site)
    if not conf:
        print(f"  ! site inconnu : {site}", file=sys.stderr)
        return 0

    chemin = conf["recherche"].format(commune=urllib.parse.quote(commune))
    url = conf["base"] + chemin

    if not robots_autorise(conf["base"], chemin):
        print(f"  ! {site} : le robots.txt interdit {chemin.split('?')[0]}", file=sys.stderr)
        print(f"    collecte abandonnee. Utilisez --source csv avec un export", file=sys.stderr)
        print(f"    dont vous avez l'usage (portail pro, flux, MLS).", file=sys.stderr)
        return 0

    try:
        req = urllib.request.Request(f"{CDP_URL}/json/version", headers={"User-Agent": UA})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        print(f"  ! Obscura CDP injoignable sur {CDP_URL}", file=sys.stderr)
        print(f"    lancez : obscura serve --port 9222", file=sys.stderr)
        return 0

    print(f"  robots.txt : {chemin.split('?')[0]} autorise")
    print(f"  collecte {site} pour {commune} via Obscura -> {url}")
    # L'extraction depend du balisage du site, qui change souvent.
    # On isole ici le point d'extension plutot que de figer des selecteurs.
    print(f"  ! extracteur {site} non implemente : le balisage evolue trop vite", file=sys.stderr)
    print(f"    pour etre fige. Branchez ScrapeGraphAI sur {url} et exportez", file=sys.stderr)
    print(f"    commune;surface;dpe;type;url, puis --source csv.", file=sys.stderr)
    return 0


# --------------------------------------------------------------- recoupement

def recouper(index, ecrire=True):
    with open(DATA_FILE, encoding="utf-8") as f:
        biens = json.load(f)

    en_vente = vierges = indecidables = 0
    for b in biens:
        if b.get("surface_m2") is None or not b.get("grade"):
            b["on_market"] = None  # signature impossible
            b["match_confiance"] = None
            indecidables += 1
            continue
        trouve, confiance, ref = index.chercher(
            b.get("city"), b["surface_m2"], b["grade"], b.get("type_batiment"),
            b.get("conso_kwh_m2_an"))
        b["on_market"] = trouve
        b["match_confiance"] = confiance
        b["match_ref"] = ref
        if trouve:
            en_vente += 1
        else:
            vierges += 1

    if ecrire:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(biens, f, ensure_ascii=False, indent=1)

    return biens, en_vente, vierges, indecidables


def rapport(biens):
    from collections import Counter
    vierges = [b for b in biens if b.get("on_market") is False]
    fg = [b for b in vierges if b.get("grade") in ("F", "G")]
    print()
    print(f"  gisement vierge        : {len(vierges)} biens")
    print(f"  dont passoires F/G     : {len(fg)}")
    if fg:
        print()
        print("  Top 5 a prospecter :")
        for b in sorted(fg, key=lambda x: x.get("score", 0), reverse=True)[:5]:
            print(f"    {b['grade']} | score {b.get('score'):5.1f} | {b['address']}, {b['city']}"
                  f" | DPE il y a {b.get('days_ago')}j")


def main():
    p = argparse.ArgumentParser(description="Ecarte les biens ADEME deja en vente")
    p.add_argument("--source", choices=["csv", "obscura", "firecrawl"], default="csv")
    p.add_argument("--max-annonces", type=int, default=25, dest="max_annonces",
                   help="plafond d'annonces ouvertes (1 credit Firecrawl chacune)")
    p.add_argument("fichier", nargs="?", help="export d'annonces (--source csv)")
    p.add_argument("--site", choices=list(SITES), default="leboncoin")
    p.add_argument("--commune", help="commune a interroger (--source obscura)")
    p.add_argument("--tolerance", type=int, default=2, help="ecart de surface tolere, en m2")
    p.add_argument("--rapport", action="store_true", help="rapport sans recollecte")
    args = p.parse_args()

    if args.rapport:
        with open(DATA_FILE, encoding="utf-8") as f:
            biens = json.load(f)
        if not any("on_market" in b for b in biens):
            print("Aucun recoupement effectue. Lancez d'abord --source csv ou obscura.")
            return 1
        rapport(biens)
        return 0

    index = IndexMarche(args.tolerance)
    if args.source == "csv":
        if not args.fichier:
            p.error("--source csv attend un fichier")
        n = charger_csv(args.fichier, index)
        print(f"{n} annonces indexees depuis {os.path.basename(args.fichier)}")
    elif args.source == "firecrawl":
        if not args.commune:
            p.error("--source firecrawl attend --commune")
        charger_firecrawl(args.site, args.commune, index, args.max_annonces)
    else:
        if not args.commune:
            p.error("--source obscura attend --commune")
        charger_obscura(args.site, args.commune, index)

    if index.total == 0:
        print("Index marche vide : aucun recoupement possible.", file=sys.stderr)
        return 1

    biens, en_vente, vierges, indecidables = recouper(index)
    print(f"\n{len(biens)} biens ADEME recoupes")
    print(f"  deja en vente  : {en_vente}   (a ecarter)")
    print(f"  gisement vierge: {vierges}   (a prospecter)")
    if indecidables:
        print(f"  indecidables   : {indecidables}   (surface ou etiquette absente)")
    rapport(biens)
    return 0


if __name__ == "__main__":
    sys.exit(main())
