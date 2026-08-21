# Conformite et cadre legal

> **Statut : document d'ingenierie, pas un avis juridique.** Il traduit l'etat du droit
> verifie au 20 aout 2026 en contraintes techniques. Il doit etre valide par un avocat
> specialise avant toute commercialisation. Les points marques **[A VALIDER]** sont ceux
> ou une lecture divergente est plausible.

## 1. Le canal telephone : perimetre exact et regime retenu

### Ce que le texte dit reellement

Le decret du 25 juillet 2026, pris en application de la loi contre toutes les fraudes aux
aides publiques, impose depuis le **11 aout 2026** le **consentement prealable** du
consommateur avant tout demarchage telephonique. Bloctel a cesse son activite.

Precision qui compte, car elle est souvent mal comprise : **l'interdiction porte sur
l'appel de prospection commerciale, pas sur la conclusion d'une vente**. Appeler un
proprietaire pour lui proposer une estimation ou un mandat entre pleinement dans le champ.
La nullite du contrat conclu est une *consequence* prevue par le texte, pas la definition
de son perimetre. L'interdiction vaut « quel que soit le secteur ».

**Deux exceptions** subsistent :

1. le **consentement prealable** — libre, specifique, eclaire, univoque, revocable, prouvable
   numero par numero, ne pouvant resulter d'une mention preredigee ni d'un renouvellement
   tacite ;
2. le **contrat en cours** — l'appel qui concerne une relation contractuelle existante.

Point aggravant pour la prospection issue de la pige : la CNIL vise explicitement le cas de
l'annonce entre particuliers — celui qui publie une annonce ne peut pas, pour autant, etre
demarche commercialement sans son accord prealable.

### Le regime retenu par le produit

Le canal telephone est **disponible**, avec deux regimes au choix de chaque agence :

| Regime | Ce qu'il autorise | Pour qui |
|---|---|---|
| `CONSENT_REQUIRED` | Consentement prealable, ou contrat en cours | Reglage conforme, recommande |
| `AGENCY_RESPONSIBILITY` | En outre, l'appel sur interet legitime | L'agence assume le risque |

Le produit **n'arbitre pas a la place du responsable de traitement**. Il fait trois choses :

- il expose le regime en clair dans l'administration, avec ses consequences, plutot que de
  le cacher derriere un interrupteur anodin ;
- il attache la **base legale revendiquee** a chaque approche preparee (`basisClaimed`) ;
- il journalise la mention de responsabilite (`agencyLiability`) quand l'agence appelle sur
  interet legitime.

En cas de controle, le journal montre sous quel fondement chaque appel a ete prepare, et a
quelle date. C'est ce que le produit peut apporter de mieux : la tracabilite du choix.

### D'ou viennent les numeros

**Jamais des donnees publiques.** Ni l'ADEME, ni DVF, ni la BAN ne contiennent de
coordonnees. Les numeros proviennent exclusivement :

- du **logiciel de pige sous licence de l'agence** (voir section 3) ;
- d'une **saisie de l'agence** (contact entrant, relation existante).

Chaque coordonnee porte sa **provenance** : editeur, reference de licence, date de constat.
Sans provenance, la coordonnee n'entre pas dans le systeme. Une coordonnee de plus de
90 jours n'est plus composable. Les numeros surtaxes sont ecartes.

## 2. La question centrale : peut-on reutiliser les DPE de l'ADEME ?

### Ce qui est etabli

- Les DPE sont publies par l'ADEME en **open data sous licence Etalab 2.0**, acces libre,
  sans cle payante. La licence autorise explicitement la reutilisation, y compris
  commerciale, sous reserve de mentionner la source.
- Le **numero de DPE et l'adresse sont publics**.

### Ou est le piege

Une licence open data **n'exonere pas du RGPD**. Une adresse de logement, croisee avec la
date d'un diagnostic et une inference de comportement (« ce proprietaire va probablement
vendre »), constitue un traitement de **donnees a caractere personnel** des lors que la
personne est identifiable — et a une adresse postale precise, elle l'est presque toujours.

De plus, il s'agit d'un **profilage** : on infere une intention future a partir de donnees
que la personne n'a pas fournies dans ce but.

La CNIL, dans ses recommandations sur la reutilisation de donnees publiees en ligne a des
fins de demarchage, pose que la reutilisation est illicite lorsqu'elle **depasse l'attente
raisonnable** de la personne. Un proprietaire qui fait realiser un DPE ne s'attend pas
raisonnablement a etre demarche par une agence pour cette raison.

### Notre position d'ingenierie **[A VALIDER]**

Nous ne pouvons pas nous appuyer sur le consentement (impossible a recueillir en amont).
Il reste l'**interet legitime** (art. 6.1.f RGPD), qui suppose de passer le test en trois
temps et de le documenter :

1. **Interet legitime reel** : la prospection commerciale est reconnue comme un interet
   legitime possible (considerant 47 RGPD).
2. **Necessite** : le traitement doit etre minimal. D'ou nos choix ci-dessous.
3. **Balance des interets** : c'est ici que ca se joue, et c'est ici que notre architecture
   fait la difference.

Les mitigations qui font pencher la balance, toutes **implementees dans le code** :

| Mitigation | Implementation |
|---|---|
| Pas d'identite | Aucun nom de proprietaire n'entre dans le systeme. Cle = adresse BAN + parcelle. |
| Pas de telephone | Aucun numero stocke. Canal desactive au niveau du domaine. |
| Pas d'enrichissement | Interdiction technique de joindre une source identifiante (annuaires, reseaux sociaux, fichiers acquis). |
| Pas de donnee sensible | Aucun signal de sante, revenu, situation familiale, origine. Liste blanche de signaux. |
| Information art. 14 | Le courrier genere **contient obligatoirement** le bloc d'information : identite du responsable, finalite, **source des donnees (ADEME/DVF)**, base legale, droits, contact DPO. Non supprimable par l'utilisateur. |
| Droit d'opposition operationnel | Liste de suppression nationale : une adresse opposee est purgee et **blacklistee pour toutes les agences clientes**, pas seulement celle qui a recu l'opposition. |
| Duree de conservation | Score et signaux purges a 24 mois ; adresse contactee conservee 3 ans en preuve d'information, puis anonymisee. |
| Tracabilite | Journal immuable : quel score, quelles donnees, quelle version du modele, quel utilisateur, quelle date. |

### Obligations non negociables

- **AIPD / DPIA obligatoire** : profilage a grande echelle de personnes non clientes. Un
  modele d'AIPD pre-rempli est livre avec le produit (`docs/annexes/aipd-modele.md`, a
  produire) — c'est un livrable commercial, pas une formalite.
- **Registre des traitements** cote agence : l'agence est responsable de traitement,
  DPE Radar AI est **sous-traitant**. Un contrat de sous-traitance art. 28 est fourni.
- **Information prealable au premier contact** : art. 14 RGPD, « au plus tard au moment de
  la premiere communication », avec mention de la source.

## 3. Canaux de contact et pige

### Tableau des canaux

| Canal | Vers un proprietaire inconnu | Base |
|---|---|---|
| **Telephone** | Selon le regime de l'agence (section 1) | Consentement, contrat en cours, ou interet legitime assume |
| **SMS** | Opt-in prealable | art. L34-5 CPCE |
| **Email** | Opt-in prealable, ou client existant pour service analogue | art. L34-5 CPCE |
| **Courrier postal adresse** | Autorise | Interet legitime + information art. 14 |
| **Imprime non adresse** | Autorise | Aucune donnee personnelle traitee |
| **Porte-a-porte** | Autorise | Demarchage a domicile encadre |
| **Inbound** | Autorise | Consentement |

### La pige : import sous licence, jamais de collecte propre

La quasi-totalite des agences dispose deja d'un outil de pige sous licence — Pige Online,
Pericles, MyPige, Directimmo — et **ces licences portent les autorisations de collecte**.

DPE Radar AI ne collecte donc **aucune annonce lui-meme**. Il **importe** l'export de
l'outil du client et le rapproche du Radar par l'identifiant BAN. Cette architecture est
licite la ou le scraping ne l'est pas : la source est sous contrat, l'agence en est
titulaire, et la provenance de chaque ligne est conservee.

L'import :

- exige un **identifiant BAN** — sans lui, la ligne ne peut pas etre rapprochee d'un bien ;
- exige une **date de constat** — c'est elle qui fait vieillir la donnee ;
- **motive chaque rejet** plutot que de perdre des lignes en silence ;
- distingue les **annonces de particuliers**, dont le regime differe ;
- normalise les numeros au format E.164 et ecarte ce qui n'est pas composable.

Ce que l'import alimente : le signal `NO_ACTIVE_LISTING`, le signal `LISTING_PRICE_DROP`,
et les coordonnees rattachees a un bien.

### Ce que le Copilote genere

Sur un bien froid, le Copilote propose les canaux que la politique autorise pour l'agence :
courrier adresse, boitage, porte-a-porte, et **telephone si l'agence a active le canal, en
assume le regime, et dispose d'un numero issu de sa pige**. Email et SMS restent reserves
aux contacts disposant d'un opt-in ou d'une relation contractuelle.

Le modele de langage, lui, ne voit **jamais** d'adresse ni d'identifiant : il recoit les
raisons du score, rien d'autre. Sa sortie est validee — un brouillon qui affirmerait que le
bien est a vendre, ou qui pretendrait detenir un acquereur, est **rejete, pas corrige**.

## 4. Ce que nous refusons de construire

Liste explicite, opposable en interne comme en avant-vente :

- Rapprochement avec un fichier de proprietaires nominatif, acquis ou scrape.
- Scraping de portails d'annonces en violation de leurs CGU (la CNIL vise explicitement le
  contournement des conditions d'utilisation des sites sources).
- Recuperation de coordonnees dans les annonces PAP pour demarchage automatise.
- Score au niveau d'une personne physique nommee.
- Toute inference sur la situation personnelle (divorce, succession, difficultes
  financieres, sante). Meme si des signaux existent, ils sont hors liste blanche.

## 5. Points a trancher par le conseil juridique **[A VALIDER]**

1. L'interet legitime tient-il face a un profilage predictif sur donnees ADEME, ou faut-il
   restreindre le ciblage aux seuls biens ou un signal d'intention *explicite* existe
   (annonce publiee, mandat expire) ?
2. Le blocage a l'adresse suffit-il a repondre a une opposition, ou faut-il un registre
   nominatif de personnes opposees — ce qui recreerait la donnee identifiante evitee ?
3. Quelle information collective preventive ? Une page publique « vos donnees et
   DPE Radar AI », referencee, pourrait servir l'art. 14 par voie de publicite **[A VALIDER :
   la CNIL exige une information individuelle avant premier contact, la page ne s'y
   substitue pas — elle la complete]**.
4. Statut exact : sous-traitant (notre position) ou responsable conjoint ? Le fait que nous
   determinions le modele de scoring plaide pour la responsabilite conjointe. **[A VALIDER]**

## 6. Coupe-circuits techniques

Trois interrupteurs, du plus large au plus fin :

- `FEATURE_OUTREACH_ENABLED=false` : plus aucune generation de message sortante.
- `phoneChannelEnabled` : canal telephone, par agence.
- `phonePolicyMode` : regime applique au telephone (`CONSENT_REQUIRED` ou
  `AGENCY_RESPONSIBILITY`).
- Liste de suppression : purge + blacklist multi-agences, appliquee avant tout affichage.

Chacun est teste. Un test qui echoue sur ces trois points **bloque le deploiement** (voir
`.github/workflows/ci.yml`).

## Sources

- CNIL — Reutilisation des donnees publiquement accessibles en ligne a des fins de demarchage commercial
- Decret du 25 juillet 2026 (JO), application de la loi contre toutes les fraudes aux aides publiques — entree en vigueur 11 aout 2026
- ADEME — Portail open data, licence Etalab 2.0, jeux `dpe03existant` / `dpe02neuf`
- RGPD art. 6.1.f, art. 14, art. 28, art. 35 ; considerant 47
- Art. L34-5 du Code des postes et des communications electroniques
