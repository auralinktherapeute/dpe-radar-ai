#!/usr/bin/env python3
"""
DPE Radar AI - CLI pour lancer des recherches par région/ville
Envoie les tâches au worker Rust via Bull MQ
"""

import redis
import json
import sys
import uuid
from datetime import datetime
import argparse

def connect_redis():
    """Connexion à Redis"""
    try:
        r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        r.ping()
        return r
    except Exception as e:
        print(f"❌ Erreur connexion Redis: {e}")
        sys.exit(1)

def submit_dpe_search(region, city, zip_code=None):
    """Soumettre une recherche DPE pour une région/ville"""
    r = connect_redis()

    task_id = str(uuid.uuid4())[:8]
    task = {
        "name": "sync-dpe-ademe",
        "id": task_id,
        "data": {
            "batch_size": 50,
            "offset": 0,
            "region": region,
            "city": city,
            "zip": zip_code or ""
        }
    }

    queue_key = "bullmq:queue:dpe-radar:waiting"
    r.rpush(queue_key, json.dumps(task))

    print(f"✅ Tâche DPE lancée")
    print(f"   ID: {task_id}")
    print(f"   Région: {region}")
    print(f"   Ville: {city}")
    if zip_code:
        print(f"   CP: {zip_code}")
    print(f"   Timestamp: {datetime.now().isoformat()}")

def submit_scoring_search(region, city, batch_size=50):
    """Soumettre un calcul de scores pour une région/ville"""
    r = connect_redis()

    task_id = str(uuid.uuid4())[:8]
    task = {
        "name": "calculate-scores",
        "id": task_id,
        "data": {
            "batch_size": batch_size,
            "offset": 0,
            "region": region,
            "city": city
        }
    }

    queue_key = "bullmq:queue:dpe-radar:waiting"
    r.rpush(queue_key, json.dumps(task))

    print(f"✅ Calcul des scores lancé")
    print(f"   ID: {task_id}")
    print(f"   Région: {region}")
    print(f"   Ville: {city}")
    print(f"   Batch: {batch_size} properties")

def submit_annonce_search(region, city):
    """Soumettre une recherche d'annonces pour une région/ville"""
    r = connect_redis()

    task_id = str(uuid.uuid4())[:8]
    task = {
        "name": "sync-annonces-obscura",
        "id": task_id,
        "data": {
            "region": region,
            "city": city,
            "property_id": f"search-{region}-{city}"
        }
    }

    queue_key = "bullmq:queue:dpe-radar:waiting"
    r.rpush(queue_key, json.dumps(task))

    print(f"✅ Scraping annonces lancé")
    print(f"   ID: {task_id}")
    print(f"   Région: {region}")
    print(f"   Ville: {city}")

def list_queue():
    """Afficher les tâches en attente"""
    r = connect_redis()
    queue_key = "bullmq:queue:dpe-radar:waiting"
    count = r.llen(queue_key)

    print(f"\n📊 Queue Status")
    print(f"   Tâches en attente: {count}")

    if count > 0:
        tasks = r.lrange(queue_key, 0, -1)
        print(f"\n   Détails:")
        for i, task_json in enumerate(tasks, 1):
            task = json.loads(task_json)
            print(f"   {i}. {task.get('name')} (ID: {task.get('id')})")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="DPE Radar AI - CLI Recherche",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  %(prog)s dpe --region alsace --city strasbourg
  %(prog)s scores --region alsace --city colmar --batch 100
  %(prog)s annonces --region alsace --city mulhouse
  %(prog)s queue
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Commandes disponibles')

    # Commande DPE
    dpe_parser = subparsers.add_parser('dpe', help='Lancer une recherche DPE')
    dpe_parser.add_argument('--region', required=True, help='Région (alsace, bourgogne...)')
    dpe_parser.add_argument('--city', required=True, help='Ville')
    dpe_parser.add_argument('--zip', help='Code postal (optionnel)')

    # Commande Scores
    scores_parser = subparsers.add_parser('scores', help='Calculer les scores')
    scores_parser.add_argument('--region', required=True, help='Région')
    scores_parser.add_argument('--city', required=True, help='Ville')
    scores_parser.add_argument('--batch', type=int, default=50, help='Taille batch (défaut: 50)')

    # Commande Annonces
    annonces_parser = subparsers.add_parser('annonces', help='Scraper les annonces')
    annonces_parser.add_argument('--region', required=True, help='Région')
    annonces_parser.add_argument('--city', required=True, help='Ville')

    # Commande Queue
    subparsers.add_parser('queue', help='Afficher les tâches en attente')

    args = parser.parse_args()

    if args.command == 'dpe':
        submit_dpe_search(args.region, args.city, args.zip)
    elif args.command == 'scores':
        submit_scoring_search(args.region, args.city, args.batch)
    elif args.command == 'annonces':
        submit_annonce_search(args.region, args.city)
    elif args.command == 'queue':
        list_queue()
    else:
        parser.print_help()
