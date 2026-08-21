#!/usr/bin/env python3
"""
Moniteur d'alertes DPE - Détecte les nouveaux DPE établis
Récupère les infos du propriétaire pour prospection AVANT la mise en vente
"""

import psycopg2
from datetime import datetime, timedelta
import json
import requests
from geopy.distance import geodesic

class DPEAlertMonitor:
    def __init__(self):
        self.conn = psycopg2.connect(
            host="localhost",
            database="dpe_radar",
            user="geraldhenry"
        )
        
    def get_recent_dpe_properties(self, city, radius_km=5):
        """
        Récupère les propriétés avec DPE établi récemment
        (derniers 30 jours = indicateur qu'une vente est probable)
        """
        cur = self.conn.cursor()
        
        # Récupérer la ville de référence et son rayon
        cur.execute("""
        SELECT latitude, longitude
        FROM therapeutes
        WHERE city = %s AND latitude IS NOT NULL
        LIMIT 1
        """, (city,))
        
        result = cur.fetchone()
        if not result:
            print(f"❌ Ville {city} non trouvée")
            return []
        
        ref_lat, ref_lon = result
        
        # Récupérer toutes les propriétés avec DPE
        cur.execute("""
        SELECT 
            t.id, t.address, t.city, t.code_postal,
            t.latitude, t.longitude, t.email, t.phone,
            d.dpe_grade, d.dpe_score, d.diagnostic_date,
            o.overall_score
        FROM therapeutes t
        LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
        LEFT JOIN opportunity_scores o ON t.id = o.property_id
        WHERE t.latitude IS NOT NULL AND d.diagnostic_date IS NOT NULL
        ORDER BY d.diagnostic_date DESC
        """)
        
        all_props = cur.fetchall()
        
        # Filtrer par rayon géographique
        nearby = []
        for prop in all_props:
            prop_lat, prop_lon = prop[4], prop[5]
            distance = geodesic((ref_lat, ref_lon), (prop_lat, prop_lon)).km
            
            if distance <= radius_km:
                nearby.append({
                    'id': prop[0],
                    'address': prop[1],
                    'city': prop[2],
                    'zip': prop[3],
                    'lat': prop[4],
                    'lon': prop[5],
                    'email': prop[6],
                    'phone': prop[7],
                    'dpe_grade': prop[8],
                    'dpe_score': prop[9],
                    'diagnostic_date': prop[10],
                    'opportunity_score': prop[11],
                    'distance_km': round(distance, 2)
                })
        
        cur.close()
        return sorted(nearby, key=lambda x: x['distance_km'])
    
    def check_recent_dpe_alerts(self, days=7):
        """
        Récupère les DPE établis dans les N derniers jours
        = propriétaires qui envisagent une vente IMMINENTE
        """
        cur = self.conn.cursor()
        
        cutoff_date = datetime.now() - timedelta(days=days)
        
        cur.execute("""
        SELECT 
            t.id, t.address, t.city, t.code_postal,
            t.latitude, t.longitude, t.email, t.phone,
            d.dpe_grade, d.dpe_score, d.diagnostic_date,
            o.overall_score,
            EXTRACT(DAY FROM NOW() - d.diagnostic_date) as days_ago
        FROM therapeutes t
        LEFT JOIN dpe_diagnostics d ON t.id = d.property_id
        LEFT JOIN opportunity_scores o ON t.id = o.property_id
        WHERE d.diagnostic_date >= %s
        ORDER BY d.diagnostic_date DESC
        """, (cutoff_date,))
        
        alerts = cur.fetchall()
        cur.close()
        
        return [{
            'id': a[0],
            'address': a[1],
            'city': a[2],
            'zip': a[3],
            'dpe_grade': a[8],
            'dpe_score': a[9],
            'diagnostic_date': a[10],
            'days_ago': int(a[12]),
            'email': a[6],
            'phone': a[7],
            'opportunity': a[11]
        } for a in alerts]
    
    def search_nearby_properties(self, city, radius_km=5, min_score=0, max_score=100):
        """Recherche avancée : ville + rayon + filtres"""
        nearby = self.get_recent_dpe_properties(city, radius_km)
        
        # Filtrer par score d'opportunité
        filtered = [p for p in nearby 
                   if p['opportunity_score'] and 
                      min_score <= p['opportunity_score'] <= max_score]
        
        return filtered

if __name__ == "__main__":
    print("🚀 DPE Radar AI - Moniteur d'Alertes DPE\n")
    
    monitor = DPEAlertMonitor()
    
    # Test 1: Alertes récentes (derniers 7 jours)
    print("⏰ ALERTES DPE (7 derniers jours) = Ventes probables IMMINENTES\n")
    alerts = monitor.check_recent_dpe_alerts(days=7)
    for alert in alerts[:5]:
        print(f"🔴 {alert['address']}, {alert['city']}")
        print(f"   DPE établi il y a {alert['days_ago']} jours")
        print(f"   Opportunité: {alert['opportunity']:.0f}/100")
        print(f"   Contact: {alert['email']} | {alert['phone']}")
        print()
    
    # Test 2: Propriétés à proximité
    print("\n📍 PROPRIÉTÉS À PROXIMITÉ (Strasbourg + 5km)\n")
    nearby = monitor.get_recent_dpe_properties("Strasbourg", radius_km=5)
    for prop in nearby[:5]:
        print(f"✓ {prop['address']}")
        print(f"  Rayon: {prop['distance_km']}km | Score: {prop['opportunity_score']:.0f}")
        print()

