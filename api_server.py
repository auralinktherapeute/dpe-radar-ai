#!/usr/bin/env python3
"""
API DPE Radar AI - serveur autonome.

Source de donnees :
  - data.json (embarque dans le repo) par defaut
  - PostgreSQL si DATABASE_URL est defini (ou si --db est passe en local)

Ecoute sur 0.0.0.0:$PORT (8000 par defaut) pour fonctionner sur Render/Railway.
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta
import json
import math
import os
import threading
import unicodedata

from suivi import code_suivi, index_codes, normaliser_code

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data.json')

# ---------------------------------------------------------------- chargement

def load_properties():
    """Charge les proprietes depuis PostgreSQL si dispo, sinon depuis data.json."""
    database_url = os.environ.get('DATABASE_URL')
    if database_url:
        try:
            import psycopg2
            conn = psycopg2.connect(database_url)
            cur = conn.cursor()
            cur.execute("""
            SELECT t.id, t.address, t.city, t.code_postal, t.latitude, t.longitude,
                   t.email, t.phone, d.dpe_grade, d.dpe_score,
                   d.diagnostic_date, o.overall_score
            FROM therapeutes t
            LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
            LEFT JOIN opportunity_scores o ON t.id = o.property_id
            ORDER BY t.id
            """)
            rows = []
            for r in cur.fetchall():
                rows.append({
                    'id': r[0], 'address': r[1], 'city': r[2], 'zip': r[3],
                    'latitude': float(r[4]) if r[4] else None,
                    'longitude': float(r[5]) if r[5] else None,
                    'email': r[6], 'phone': r[7],
                    'grade': r[8], 'dpe_score': r[9],
                    'diagnostic_date': r[10].isoformat() if r[10] else None,
                    'score': float(r[11]) if r[11] else 0,
                })
            cur.close()
            conn.close()
            print(f"[data] {len(rows)} proprietes chargees depuis PostgreSQL")
            return rows
        except Exception as e:
            print(f"[data] PostgreSQL indisponible ({e}), bascule sur data.json")

    with open(DATA_FILE, encoding='utf-8') as f:
        rows = json.load(f)
    print(f"[data] {len(rows)} proprietes chargees depuis data.json")
    return rows


PROPERTIES = load_properties()


# --------------------------------------------------------- rafraichissement

def _age_donnees():
    """Anciennete du DPE le plus recent du jeu, en jours. None si indeterminable."""
    dates = [p.get('diagnostic_date') for p in PROPERTIES if p.get('diagnostic_date')]
    if not dates:
        return None
    try:
        return (datetime.now() - datetime.fromisoformat(max(dates))).days
    except ValueError:
        return None


def _rafraichir_en_fond():
    """Recharge depuis l'ADEME sans jamais interrompre le service.

    L'instance gratuite Render s'endort puis redemarre : ce reveil sert de
    cadence de rafraichissement, sans cron ni planificateur externe. Les
    donnees existantes restent servies pendant toute l'operation, et toute
    erreur laisse simplement le jeu en place.
    """
    global PROPERTIES
    try:
        from ademe_connector import recuperer, normaliser
        depuis = (datetime.now() - timedelta(days=REFRESH_FENETRE)).strftime('%Y-%m-%d')
        print(f"[refresh] interrogation ADEME depuis {depuis}", flush=True)

        brut = recuperer(REFRESH_DEPARTEMENTS, depuis, maximum=REFRESH_MAX)
        biens = [normaliser(b) for b in brut]
        biens = [b for b in biens if b.get('address') and b.get('city')]
        if not biens:
            print("[refresh] aucun bien renvoye, jeu actuel conserve", flush=True)
            return

        par_adresse = {}
        for b in sorted(biens, key=lambda x: x.get('diagnostic_date') or '', reverse=True):
            par_adresse.setdefault((b['address'].lower(), b['city'].lower()), b)
        biens = sorted(par_adresse.values(), key=lambda x: x.get('score') or 0, reverse=True)

        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(biens, f, ensure_ascii=False, indent=1)
        PROPERTIES = biens
        print(f"[refresh] {len(biens)} biens rafraichis depuis l'ADEME", flush=True)
    except Exception as e:
        print(f"[refresh] echec ({type(e).__name__}: {e}), jeu actuel conserve", flush=True)


REFRESH_ACTIF = os.environ.get('ADEME_AUTO_REFRESH', '1') not in ('0', 'false', 'no')
REFRESH_SEUIL = int(os.environ.get('ADEME_REFRESH_JOURS', 7))
REFRESH_FENETRE = int(os.environ.get('ADEME_FENETRE_JOURS', 60))
REFRESH_MAX = int(os.environ.get('ADEME_MAX', 3000))
REFRESH_DEPARTEMENTS = os.environ.get('ADEME_DEPARTEMENTS', '67,68').split(',')


def demarrer_rafraichissement():
    if not REFRESH_ACTIF:
        return
    age = _age_donnees()
    if age is None or age < REFRESH_SEUIL:
        print(f"[refresh] donnees vieilles de {age} jours, seuil {REFRESH_SEUIL} : rien a faire",
              flush=True)
        return
    print(f"[refresh] donnees vieilles de {age} jours : rafraichissement en arriere-plan",
          flush=True)
    threading.Thread(target=_rafraichir_en_fond, daemon=True).start()

# ------------------------------------------------------------------ helpers

def normalize(text):
    """minuscule, sans accent, sans tiret/espace : 'Sélestat' -> 'selestat'."""
    if not text:
        return ''
    text = unicodedata.normalize('NFD', text)
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    return ''.join(c for c in text.lower() if c.isalnum())


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def list_cities():
    counts = {}
    for p in PROPERTIES:
        if p.get('city'):
            counts[p['city']] = counts.get(p['city'], 0) + 1
    return [{'name': name, 'count': counts[name]} for name in sorted(counts)]


def resolve_city(query):
    """Trouve la ville : exact, puis sans accent, puis correspondance partielle."""
    names = [c['name'] for c in list_cities()]
    q = normalize(query)
    for name in names:
        if normalize(name) == q:
            return name
    for name in names:
        n = normalize(name)
        if q and (q in n or n in q):
            return name
    return None


def city_center(city):
    pts = [(p['latitude'], p['longitude']) for p in PROPERTIES
           if p['city'] == city and p.get('latitude') and p.get('longitude')]
    if not pts:
        return None
    return (sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts))

# ---------------------------------------------------------------- endpoints

def endpoint_cities(_params):
    return list_cities()


def endpoint_search(params):
    query = params.get('city', [''])[0].strip()
    radius = float(params.get('radius', [5])[0])
    min_score = float(params.get('min_score', [0])[0])
    max_score = float(params.get('max_score', [100])[0])

    # Anciennete max du DPE, en jours. 0 ou absent = pas de filtre.
    days = int(params.get('days', [0])[0] or 0)
    cutoff = datetime.now() - timedelta(days=days) if days > 0 else None

    if not query:
        return {'error': 'ville manquante', 'available_cities': [c['name'] for c in list_cities()]}

    city = resolve_city(query)
    if not city:
        return {'error': f'ville "{query}" introuvable',
                'available_cities': [c['name'] for c in list_cities()]}

    center = city_center(city)
    if not center:
        return {'error': f'pas de coordonnees pour "{city}"',
                'available_cities': [c['name'] for c in list_cities()]}

    ref_lat, ref_lon = center
    results = []
    for p in PROPERTIES:
        if not (p.get('latitude') and p.get('longitude')):
            continue
        distance = haversine_km(ref_lat, ref_lon, p['latitude'], p['longitude'])
        if distance > radius:
            continue
        score = p.get('score') or 0
        if not (min_score <= score <= max_score):
            continue

        established = None
        if p.get('diagnostic_date'):
            try:
                established = datetime.fromisoformat(p['diagnostic_date'])
            except ValueError:
                established = None
        if cutoff and (established is None or established < cutoff):
            continue

        results.append({
            'id': p['id'], 'address': p['address'], 'city': p['city'], 'zip': p['zip'],
            'grade': p.get('grade') or 'N/A', 'score': score,
            'email': p.get('email'), 'phone': p.get('phone'),
            'owner_name': p.get('owner_name'),
            'diagnostic_date': p.get('diagnostic_date'),
            'days_ago': (datetime.now() - established).days if established else None,
            'distance_km': round(distance, 2),
            # Donnees ADEME reelles
            'numero_dpe': p.get('numero_dpe'),
            'surface_m2': p.get('surface_m2'),
            'type_batiment': p.get('type_batiment'),
            'conso_kwh_m2_an': p.get('conso_kwh_m2_an'),
            'grade_ges': p.get('grade_ges'),
            'source': p.get('source'),
            'code_suivi': code_suivi(p.get('numero_dpe')),
        })
    results.sort(key=lambda r: r['distance_km'])
    return results


def endpoint_alerts(params):
    hours = int(params.get('hours', [24])[0])
    limit = int(params.get('limit', [20])[0])
    cutoff = datetime.now() - timedelta(hours=hours)

    alerts = []
    for p in PROPERTIES:
        # L'alerte repose sur la date du DPE, pas sur la presence d'un contact :
        # les donnees ADEME n'en contiennent aucun.
        if not p.get('diagnostic_date'):
            continue
        try:
            # L'ADEME date au jour (2026-08-10), sans heure.
            established = datetime.fromisoformat(p['diagnostic_date'])
        except ValueError:
            continue
        if established < cutoff:
            continue
        hours_ago = int((datetime.now() - established).total_seconds() // 3600)
        alerts.append({
            'id': p['id'], 'address': p['address'], 'city': p['city'], 'zip': p['zip'],
            'email': p['email'], 'phone': p.get('phone'),
            'dpe_grade': p.get('grade') or 'N/A', 'dpe_score': p.get('dpe_score'),
            'diagnostic_date': p['diagnostic_date'],
            'opportunity_score': p.get('score') or 0,
            'hours_ago': hours_ago,
            'days_ago': hours_ago // 24,
            'surface_m2': p.get('surface_m2'),
            'type_batiment': p.get('type_batiment'),
            'numero_dpe': p.get('numero_dpe'),
            'alert_priority': 'URGENT' if hours_ago < 12 else 'HIGH',
        })
    alerts.sort(key=lambda a: a['opportunity_score'], reverse=True)
    return alerts[:limit]


def endpoint_properties(_params):
    return [{
        'id': p['id'], 'address': p['address'], 'city': p['city'],
        'grade': p.get('grade') or 'N/A', 'score': p.get('score') or 0,
        'email': p.get('email'), 'phone': p.get('phone'),
        'diagnostic_date': p.get('diagnostic_date'),
    } for p in PROPERTIES]


def _lire_leads_supabase():
    """Lit les leads via la cle service_role, qui contourne RLS.

    Cette cle ne quitte jamais le serveur : le navigateur n'appelle que
    /api/leads, lui-meme protege par ADMIN_TOKEN.
    """
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        return None
    import urllib.request
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/leads?select=*&order=recu_le.desc',
        headers={'apikey': SUPABASE_SERVICE_KEY,
                 'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
                 'Accept-Profile': 'dpe_radar'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        print(f"[leads] lecture Supabase impossible ({type(e).__name__}: {e})", flush=True)
        return None


def endpoint_leads(params):
    """Coordonnees transmises spontanement. Acces restreint : donnees personnelles."""
    if not ADMIN_TOKEN:
        return {'error': "ADMIN_TOKEN non configure : consultation des leads desactivee"}
    if params.get('token', [''])[0] != ADMIN_TOKEN:
        return {'error': 'jeton invalide'}

    distants = _lire_leads_supabase()
    if distants is not None:
        return distants
    if os.path.exists(LEADS_FILE):
        with open(LEADS_FILE, encoding='utf-8') as f:
            return json.load(f)
    return []


ROUTES = {
    '/api/cities': endpoint_cities,
    '/api/search': endpoint_search,
    '/api/dpe-alerts': endpoint_alerts,
    '/api/properties': endpoint_properties,
    '/api/leads': endpoint_leads,
}

# ------------------------------------------------------ reponses proprietaires

LEADS_FILE = os.path.join(BASE_DIR, 'leads.json')


def page_reponse(bien, code):
    """Page d'atterrissage : le bien est deja identifie par le code du courrier."""
    if not bien:
        corps = """<h1>Code non reconnu</h1>
        <p>Verifiez le code figurant sur votre courrier.</p>"""
    else:
        surface = f"{bien['surface_m2']} m²" if bien.get('surface_m2') else ''
        corps = f"""
        <h1>Votre bien</h1>
        <div class="bien">
          <strong>{bien['address']}</strong><br>
          {bien.get('zip') or ''} {bien.get('city') or ''}<br>
          <span class="meta">DPE {bien.get('grade')} · {surface} · établi le
          {bien.get('diagnostic_date') or ''}</span>
        </div>
        <p>Pour recevoir une estimation sans engagement, laissez-nous vos
        coordonnées. Vous pouvez demander leur suppression à tout moment.</p>
        <form method="POST" action="/api/lead">
          <input type="hidden" name="code" value="{code}">
          <label>Nom<input name="nom" required></label>
          <label>Téléphone<input name="telephone" type="tel"></label>
          <label>Email<input name="email" type="email"></label>
          <label>Message<textarea name="message" rows="3"></textarea></label>
          <label class="consent">
            <input type="checkbox" name="consentement" value="oui" required>
            J'accepte d'être recontacté au sujet de ce bien.
          </label>
          <button type="submit">Envoyer</button>
        </form>"""

    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Estimation de votre bien</title><style>
body{{background:#1a0a2e;color:#fff;font-family:-apple-system,sans-serif;
margin:0;padding:24px;line-height:1.6}}
.wrap{{max-width:520px;margin:0 auto}}
h1{{font-size:24px;background:linear-gradient(135deg,#a855f7,#22d3ee);
-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
.bien{{background:rgba(45,27,78,.8);border:1px solid rgba(168,85,247,.25);
border-radius:12px;padding:16px;margin:16px 0}}
.meta{{color:rgba(255,255,255,.6);font-size:14px}}
label{{display:block;margin:14px 0;font-size:14px;color:#22d3ee}}
input,textarea{{width:100%;box-sizing:border-box;margin-top:6px;padding:12px;
border-radius:8px;border:1px solid rgba(168,85,247,.25);
background:rgba(26,10,46,.8);color:#fff;font-size:16px}}
.consent{{color:rgba(255,255,255,.75);font-size:13px}}
.consent input{{width:auto;margin-right:8px}}
button{{background:linear-gradient(135deg,#8b5cf6,#06b6d4);color:#fff;border:0;
padding:14px 28px;border-radius:8px;font-size:16px;font-weight:600;
cursor:pointer;width:100%;margin-top:8px}}
</style></head><body><div class="wrap">{corps}</div></body></html>"""


SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
ADMIN_TOKEN = os.environ.get('ADMIN_TOKEN', '')


def _pousser_supabase(lead):
    """Depose le lead via la fonction RPC. Renvoie True si accepte.

    Le disque de l'instance Render est ephemere : sans cette persistance,
    tout lead serait perdu au prochain redemarrage.
    """
    if not (SUPABASE_URL and SUPABASE_KEY):
        return False
    import urllib.request
    corps = json.dumps({
        'p_code': lead['code'], 'p_nom': lead['nom'],
        'p_telephone': lead['telephone'] or None, 'p_email': lead['email'] or None,
        'p_message': lead['message'] or None, 'p_adresse': lead['adresse'],
        'p_commune': lead['commune'], 'p_code_postal': lead.get('code_postal'),
        'p_grade': lead['grade'], 'p_numero_dpe': lead['numero_dpe'],
    }).encode('utf-8')
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/rpc/dpe_radar_submit_lead',
        data=corps, method='POST',
        headers={'Content-Type': 'application/json',
                 'apikey': SUPABASE_KEY,
                 'Authorization': f'Bearer {SUPABASE_KEY}'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return 200 <= r.status < 300
    except Exception as e:
        print(f"[lead] Supabase refuse ({type(e).__name__}: {e})", flush=True)
        return False


def enregistrer_lead(champs, index):
    code = normaliser_code(champs.get('code', [''])[0])
    bien = index.get(code)
    lead = {
        'recu_le': datetime.now().isoformat(timespec='seconds'),
        'code': champs.get('code', [''])[0],
        'nom': champs.get('nom', [''])[0].strip(),
        'telephone': champs.get('telephone', [''])[0].strip(),
        'email': champs.get('email', [''])[0].strip(),
        'message': champs.get('message', [''])[0].strip(),
        'consentement': champs.get('consentement', [''])[0] == 'oui',
        'numero_dpe': bien.get('numero_dpe') if bien else None,
        'adresse': bien.get('address') if bien else None,
        'commune': bien.get('city') if bien else None,
        'grade': bien.get('grade') if bien else None,
    }
    lead['code_postal'] = bien.get('zip') if bien else None

    lead['persiste'] = _pousser_supabase(lead)
    if not lead['persiste']:
        # Repli local : mieux vaut un fichier ephemere que rien du tout.
        # Sur Render il disparaitra au redemarrage, d'ou le log explicite.
        leads = []
        if os.path.exists(LEADS_FILE):
            try:
                with open(LEADS_FILE, encoding='utf-8') as f:
                    leads = json.load(f)
            except (ValueError, OSError):
                leads = []
        leads.append(lead)
        with open(LEADS_FILE, 'w', encoding='utf-8') as f:
            json.dump(leads, f, ensure_ascii=False, indent=1)
        print("[lead] ecrit en local seulement : configurez SUPABASE_URL et "
              "SUPABASE_ANON_KEY pour une persistance durable", flush=True)
    return lead

# ------------------------------------------------------------------- server

class APIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        handler = ROUTES.get(parsed.path)

        if handler:
            try:
                payload = handler(parse_qs(parsed.query))
                self._send_json(200, payload)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # Page de reponse : /r/<code> figurant sur le courrier
        if parsed.path.startswith('/r/'):
            code = normaliser_code(parsed.path[3:])
            self._send_html(200, page_reponse(index_codes(PROPERTIES).get(code),
                                              parsed.path[3:]))
            return

        if parsed.path in ('/', ''):
            self.path = '/results.html'
        elif parsed.path == '/health':
            self._send_json(200, {'status': 'ok', 'properties': len(PROPERTIES)})
            return

        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != '/api/lead':
            self._send_json(404, {'error': 'route inconnue'})
            return
        try:
            taille = int(self.headers.get('Content-Length', 0))
            if taille > 16384:               # un formulaire ne pese pas plus
                self._send_json(413, {'error': 'requete trop volumineuse'})
                return
            champs = parse_qs(self.rfile.read(taille).decode('utf-8'))
            lead = enregistrer_lead(champs, index_codes(PROPERTIES))
            print(f"[lead] {lead['nom']} - {lead['adresse'] or 'code inconnu'}", flush=True)
            self._send_html(200, """<!DOCTYPE html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Merci</title><style>body{background:#1a0a2e;color:#fff;
font-family:-apple-system,sans-serif;padding:40px;text-align:center;
line-height:1.6}h1{color:#22d3ee}</style></head><body>
<h1>Merci</h1><p>Votre demande est enregistree.<br>
Vous serez recontacte prochainement.</p></body></html>""")
        except Exception as e:
            self._send_json(500, {'error': str(e)})

    def _send_html(self, status, html):
        body = html.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        return super().end_headers()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    demarrer_rafraichissement()
    server = HTTPServer(('0.0.0.0', port), APIHandler)
    print(f"""
+------------------------------------------------------------+
|            DPE Radar AI - Serveur API demarre              |
+------------------------------------------------------------+

  Port      : {port}
  Donnees   : {len(PROPERTIES)} proprietes
  Endpoints : /api/cities  /api/search  /api/dpe-alerts
              /api/properties  /health
""", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur arrete")
