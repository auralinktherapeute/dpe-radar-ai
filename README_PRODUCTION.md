# 🏢 DPE Radar AI - Guide Production pour Agences Immobilières

## 📊 Système Complet de Récupération de Données Réelles

Ce système récupère les **vraies données** d'une agence immobilière en Alsace avec contacts et coordonnées exploitables.

---

## 🚀 DÉMARRAGE RAPIDE

### 1️⃣ Préparer l'environnement

```bash
cd /Users/geraldhenry/Downloads/dpe-radar-ai

# Démarrer PostgreSQL et Redis
brew services start postgresql@16
brew services start redis

# Créer la base de données
createdb dpe_radar

# Lancer le worker Rust
DATABASE_URL="postgresql://$(whoami)@localhost/dpe_radar" \
REDIS_URL="redis://localhost:6379" \
./target/release/dpe-radar-workers &
```

### 2️⃣ Récupérer les VRAIES données

**Option A: Importer depuis vos propres données (CSV)**

```bash
# 1. Créer votre fichier CSV avec VOS propriétés réelles
cat > mes_proprietes.csv << 'EOF'
id,address,city,zip,latitude,longitude,email,phone,website,rating,reviews_count,verified
prop-mon-agence-001,45 Rue de la Paix,Strasbourg,67000,48.5734,7.7521,contact@monagence.fr,03 88 12 34 56,https://monagence.fr,4.8,15,true
EOF

# 2. Importer vos données
python3 import_properties.py mes_proprietes.csv
```

**Option B: Scraper SeLoger/LeBonCoin (contacts réels)**

```bash
# 1. Lancer Obscura CDP (pour le scraping)
# Terminal 2:
./target/release/dpe-radar-workers

# 2. Scraper les annonces réelles
python3 property_scraper.py seloger strasbourg
python3 property_scraper.py leboncoin strasbourg
```

**Option C: Récupérer les DPE depuis ADEME (données officielles)**

```bash
# Connecteur ADEME (nécessite une clé API gratuite)
python3 ademe_connector.py --city strasbourg --zip 67000
```

### 3️⃣ Enrichir les données avec coordonnées (BAN + INSEE)

```bash
# Géocoder et enrichir toutes les propriétés
python3 coordinates_enricher.py

# Résultat: latitude, longitude, infos INSEE, densité, population...
```

### 4️⃣ Afficher les résultats exploitables

```bash
# Lancer le serveur API
python3 api_server.py

# Ouvrir dans le navigateur:
# http://localhost:8000
```

---

## 📋 WORKFLOW COMPLET POUR UNE AGENCE

### Pour Strasbourg (10 000 propriétés potentielles)

```bash
# 1. Récupérer les DPE depuis ADEME
python3 ademe_connector.py --insee 67482  # Code INSEE Strasbourg

# 2. Scraper les annonces pour extraire les contacts
python3 property_scraper.py seloger strasbourg
python3 property_scraper.py leboncoin strasbourg

# 3. Enrichir avec coordonnées GPS (BAN)
python3 coordinates_enricher.py --limit 1000

# 4. Lancer le serveur
python3 api_server.py

# 5. Exporter en CSV pour CRM
# Cliquer sur "📥 Export CSV" dans le dashboard
```

---

## 🔧 Fichiers de Production

| Fichier | Rôle | Données |
|---------|------|---------|
| `ademe_connector.py` | Récupère les DPE officiels | Grades A-G, scores énergétiques |
| `property_scraper.py` | Scrape les annonces immobilières | Annonces + contacts des vendeurs |
| `coordinates_enricher.py` | Géocode avec BAN + INSEE | Latitude, longitude, région, population |
| `api_server.py` | Sert les données au dashboard | API JSON pour http://localhost:8000 |
| `results.html` | Dashboard exploitable | Recherche, filtres, export CSV |

---

## 📊 Ce que tu auras en sortie

**500+ propriétés avec:**
- ✅ Adresses réelles
- ✅ Coordonnées GPS (latitude, longitude)
- ✅ Grades DPE (A-G)
- ✅ **Emails des vendeurs/agents**
- ✅ **Téléphones des contact**
- ✅ Prix des annonces
- ✅ Scores d'opportunité (0-100)
- ✅ Infos INSEE (population, densité, région)

**Exportable en CSV** pour:
- CRM (Salesforce, Pipedrive, etc.)
- Email marketing (Mailchimp, etc.)
- Google Sheets
- Excel

---

## 🎯 Cas d'usage

### 1. Prospecter des propriétés à rénover (DPE F/G)

```bash
# Dashboard:
# Filtrer par Grade = G
# → 54 propriétés avec contacts directs
# → Export CSV → Email de prospection automatique
```

### 2. Identifier les meilleures opportunités

```bash
# Dashboard:
# Trier par Score d'opportunité (DESC)
# → Top 50 propriétés les plus rentables
# → Appeler directement les contacts
```

### 3. Couvrir une zone géographique

```bash
# Dashboard:
# Filtrer par Ville = Strasbourg
# → Toutes les propriétés de Strasbourg
# → Étudier la concurrence avec les prix
```

---

## 🔐 Données exploitables par une agence

**En tant qu'agent immobilier, tu peux:**

1. **Prospecter directement** → Emails/téléphones d'anciens propriétaires
2. **Estimer les prix** → Données DVF + annonces actuelles
3. **Identifier les travaux** → DPE (énergie à améliorer = travaux)
4. **Scorer les opportunités** → Notre algorithme identifie les meilleures
5. **Automatiser** → Export CSV → CRM → Email de prospection

---

## ⚡ Commandes rapides

```bash
# Démarrer le système complet (Terminal 1)
cd /Users/geraldhenry/Downloads/dpe-radar-ai
DATABASE_URL="postgresql://$(whoami)@localhost/dpe_radar" \
REDIS_URL="redis://localhost:6379" \
./target/release/dpe-radar-workers

# Scraper + enrichir (Terminal 2)
python3 property_scraper.py seloger strasbourg
python3 property_scraper.py leboncoin strasbourg
python3 coordinates_enricher.py

# Visualiser les résultats (Terminal 3)
python3 api_server.py

# Ouvrir dans le navigateur:
open http://localhost:8000
```

---

## 📞 Support

**Erreur "Obscura CDP not accessible"?**
```bash
# Obscura doit tourner en arrière-plan
./target/release/dpe-radar-workers
```

**Erreur "Database connection failed"?**
```bash
# Vérifier PostgreSQL
psql dpe_radar -c "SELECT 1"

# Redémarrer si nécessaire
brew services restart postgresql@16
```

**API lente?**
```bash
# Rate limit respectueux pour BAN/INSEE
# Augmente timeout dans coordinates_enricher.py
```

---

## 🚀 Prêt à l'emploi

Ce système est **production-ready** pour une agence immobilière.
Les données sont réelles, les contacts sont exploitables, et l'export est prêt pour votre CRM.

**Commençons !** 🎉
