#!/usr/bin/env python3
"""
Codes de suivi - relie un courrier a un bien, et une reponse a un courrier.

Un code court et stable est derive du numero de DPE. Il figure sur le pli ;
le proprietaire qui repond arrive sur une page identifiant deja son bien,
et n'a plus qu'a laisser ses coordonnees.

Le code ne contient aucune donnee personnelle : c'est un derive du numero de
DPE, lui-meme public. Il est deterministe, donc un meme bien porte toujours
le meme code d'une campagne a l'autre.
"""

import hashlib

# Sans I, O, 0, 1 : un code lu sur papier puis retape ne doit pas preter
# a confusion.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LONGUEUR = 6


def code_suivi(numero_dpe):
    """Code court et stable pour un bien. Ex : '2667E2050290C' -> 'K7M2QX'."""
    if not numero_dpe:
        return None
    digest = hashlib.sha256(str(numero_dpe).encode("utf-8")).digest()
    valeur = int.from_bytes(digest[:8], "big")
    code = ""
    for _ in range(LONGUEUR):
        valeur, reste = divmod(valeur, len(ALPHABET))
        code += ALPHABET[reste]
    return code


def normaliser_code(saisi):
    """Tolere les erreurs de saisie courantes : minuscules, O/0, I/1, espaces."""
    if not saisi:
        return ""
    t = str(saisi).upper().strip().replace(" ", "").replace("-", "")
    return t.replace("O", "Q").replace("0", "Q").replace("I", "J").replace("1", "J")


def index_codes(biens):
    """Table code -> bien, tolerante aux confusions de caracteres."""
    index = {}
    for b in biens:
        c = code_suivi(b.get("numero_dpe"))
        if c:
            index[c] = b
            index[normaliser_code(c)] = b
    return index


if __name__ == "__main__":
    import json
    import os
    from collections import Counter

    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
    biens = json.load(open(chemin, encoding="utf-8"))
    codes = [code_suivi(b.get("numero_dpe")) for b in biens]
    codes = [c for c in codes if c]

    doublons = [c for c, n in Counter(codes).items() if n > 1]
    print(f"{len(codes)} codes generes")
    print(f"  collisions : {len(doublons)}")
    print(f"  exemples   : {', '.join(codes[:6])}")
