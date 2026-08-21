# Donnees et sources

> Tout ce document a ete verifie en interrogeant les sources reelles le
> **20 aout 2026**. Les volumes et comportements decrits sont observes, pas
> supposes.

## 1. ADEME — Observatoire DPE

| | |
|---|---|
| Jeu | `dpe03existant` (logements existants depuis juillet 2021) |
| Endpoint | `https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines` |
| Volume observe | **15 409 991** diagnostics |
| Flux | **~274 000** receptions/mois, soit ~100/heure au national |
| Licence | Etalab 2.0 — reutilisation commerciale autorisee, source a mentionner |
| Cle API | aucune ; quotas de debit sur usage intensif |

### Champs retenus

`numero_dpe` · `etiquette_dpe` · `date_etablissement_dpe` ·
`date_reception_dpe` · `adresse_ban` · `code_insee_ban` · `identifiant_ban` ·
`score_ban` · `statut_geocodage` · `surface_habitable_logement` ·
`type_batiment`

Le jeu complet depasse 200 colonnes ; on n'en demande que onze. La minimisation
n'est pas qu'une posture RGPD, elle divise aussi le cout de transfert.

### Trois constats qui ont change l'implementation

**a) Filtrer sur la reception, pas sur l'etablissement.** Un diagnostic peut
etre etabli en juin et publie en aout. Un incremental cale sur
`date_etablissement_dpe` raterait silencieusement ces lignes. Syntaxe validee :
`qs=date_reception_dpe:[2026-08-01 TO *]`.

**b) Le geocodage est deja dans le jeu.** `identifiant_ban`, `score_ban` et
`statut_geocodage` sont fournis. Sur l'echantillon observe, **200 lignes sur
200** portaient un identifiant BAN a l'adresse. On economise donc l'essentiel
des appels a la Base Adresse Nationale, qui est un service public a debit
limite. Le geocodeur ne sert plus qu'en repli.

**c) `statut_geocodage` ne prend que deux valeurs** : geocodee a l'adresse, ou
non geocodee faute de correspondance. Mais « a l'adresse » ne garantit **pas**
la presence d'un numero de voie : on a releve `Rue de la Krutenau 67000
Strasbourg`, sans numero, avec un `score_ban` de 0,92. On ne peut pas y adresser
un courrier. La precision est donc degradee a `STREET` des que l'identifiant BAN
porte un numero nul, quel que soit le score.

## 2. DVF — Demandes de valeurs foncieres

| | |
|---|---|
| Source | `https://files.data.gouv.fr/geo-dvf/latest/csv/{annee}/communes/{dep}/{insee}.csv` |
| Annees disponibles | 2021 a 2025 |
| Format | CSV brut par commune (les departements sont en `.csv.gz`) |
| Exemple mesure | Bordeaux (33063), 2024 : **11 681 lignes**, 2 Mo |

### Constat n°1 — une lacune territoriale majeure

Les fichiers departementaux **57, 67, 68 et 976 renvoient 404**, alors que 01,
13, 75 et 971 repondent 200.

Ce n'est pas une panne. L'**Alsace-Moselle** releve du regime du **livre
foncier** issu du droit local, et non de la publicite fonciere qui alimente DVF.
Mayotte est hors dispositif pour des raisons cadastrales distinctes.

**Consequence produit :** sur ces territoires, `HOLDING_DURATION`,
`MARKET_VELOCITY` et `PRICE_MOMENTUM` sont structurellement indisponibles, soit
**30 des 100 points du bareme**. Le score reste calculable, la confiance plafonne
a **85**, et les scores ne sont **pas comparables** avec ceux d'un territoire
couvert (voir constat n°3).

C'est une contrainte de go-to-market, pas seulement de technique : une agence de
Strasbourg, Colmar ou Metz n'aura jamais le produit complet. Le discours
commercial doit le dire avant la signature, pas apres.

### Constat n°2 — le piege du decalage de publication

DVF est publie par vagues, avec plusieurs mois de retard. Ancrer les fenetres
glissantes sur la date du jour compare un dernier exercice **tronque** a un
exercice complet.

Mesure reelle sur Bordeaux avant correction :

> `1878 ventes sur 12 mois contre 4660 l'annee precedente` → −60 %

Le marche bordelais ne s'est pas effondre : les douze derniers mois n'etaient
tout simplement pas publies. Le signal aurait lu un effondrement **partout en
France**, silencieusement.

Correction retenue : les fenetres sont ancrees sur la **derniere mutation
effectivement publiee**, et `observedAt` porte cette date — ce qui fait baisser
la confiance a proportion du retard, au lieu de fausser le signal. Apres
correction, la meme commune donne :

> `4905 ventes sur 12 mois contre 3997 l'annee precedente` → +23 %

Un test de regression verrouille ce comportement.

### Constat n°3 — compter les mutations, pas les lignes

Une vente couvrant plusieurs lots produit plusieurs lignes CSV partageant le
meme `id_mutation`. Compter les lignes surestime le volume de 20 a 40 %. On
compte donc les `id_mutation` distincts.

On ecarte par ailleurs les prix au m2 hors de `[200 €, 30 000 €]` : viagers,
cessions intrafamiliales et erreurs de saisie deforment la mediane sur petits
volumes.

## 3. La jointure ADEME <-> DVF

C'est le chainon technique central du produit, et il est **exact**.

```
ADEME  identifiant_ban = "33063_9315_00051"
                          └─┬─┘ └┬─┘ └─┬─┘
                          INSEE voie  numero

DVF    code_commune = 33063 · adresse_code_voie = 9315 · adresse_numero = 51
```

L'identifiant BAN se decompose en `{INSEE}_{code voie}_{numero sur 5}`, et DVF
porte les memes composants en colonnes separees. Verifie sur donnees reelles
(Bordeaux, `51 Cours Victor Hugo`).

**Aucun appariement flou de libelles de voie n'est necessaire** — ce qui elimine
la principale source de faux positifs de ce type d'outil. « 51 Cours Victor
Hugo » et « 51 crs Victor-Hugo » n'ont jamais a etre rapproches par similarite.

## 4. Base Adresse Nationale

Utilisee **en repli uniquement**, quand l'ADEME n'a pas geocode. Requetes
contraintes par `citycode` pour eviter les appariements entre communes
homonymes.

## 5. Pige des annonces — import sous licence de l'agence

Le scraping des portails est ecarte (CGU + position CNIL sur le contournement des sites
sources). La voie retenue s'appuie sur un fait de marche : **la quasi-totalite des agences
dispose deja d'un outil de pige sous licence**, qui porte les autorisations.

DPE Radar AI importe donc l'export du client plutot que de collecter :

| Editeur | Mode |
|---|---|
| Pige Online, Pericles, MyPige, Directimmo | Export CSV ou API, mapping de colonnes configurable |
| CSV generique | Mapping libre |

Colonnes attendues : identifiant BAN, statut, prix initial, prix actuel, telephone, email,
type de vendeur, date de constat. Le mapping est parametrable par editeur — c'est le seul
point a ajuster pour en brancher un nouveau.

Regles d'import :

- **identifiant BAN obligatoire** : c'est la cle de rapprochement avec le Radar ;
- **date de constat obligatoire** : au-dela de 45 jours l'annonce n'est plus affirmee, au-dela
  de 90 jours la coordonnee n'est plus composable ;
- **rejets motives et comptes** : un import qui perd 30 % des lignes sans le dire est pire
  qu'un import qui echoue ;
- **provenance conservee** : editeur, reference de licence, date. Sans provenance, pas de
  coordonnee.

Absence de ligne dans la pige = **absence d'information**, pas absence d'annonce. Le signal
`NO_ACTIVE_LISTING` n'est alors pas emis du tout, et la confiance baisse — plutot que
d'affirmer a tort qu'un bien n'est pas en vente.

## 6. Recapitulatif des risques de donnees

| Risque | Gravite | Etat |
|---|---|---|
| Alsace-Moselle et Mayotte hors DVF | **Elevee** | Documente, encode, teste |
| Decalage de publication DVF | **Elevee** | Corrige, test de regression |
| Scores non comparables entre regimes | Moyenne | Encode (`comparabilityGroup`) |
| Pige des annonces | Moyenne | Resolu par import sous licence de l’agence |
| Adresses sans numero declarees geocodees | Moyenne | Corrige |
| Quotas de debit ADEME | Faible | Filtrage au secteur souscrit |
