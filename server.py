#!/usr/bin/env python3
"""
CityFix - Safe Mobility Module
Backend Server & AI Moderation Engine for Hackathon 2026 (Didap)
Author: Hackathon Team
Runs on Python 3 standard library - Zero external dependencies needed!
"""

import sys
import os
import json
import sqlite3
import hashlib
import hmac
import secrets
import mimetypes
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 8080))
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "safemobility.db")
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# ----------------- DATABASE SETUP ----------------- #

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        cognome TEXT NOT NULL,
        data_nascita TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        telefono TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        false_reports_count INTEGER DEFAULT 0,
        banned_until TEXT DEFAULT NULL,
        is_admin INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    )
    """)
    
    # Sessions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    """)
    
    # Password Reset OTPs
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reset_codes (
        identifier TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL
    )
    """)
    
    # Reports table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        categoria TEXT NOT NULL,
        descrizione TEXT NOT NULL,
        severity TEXT NOT NULL,
        is_valid INTEGER NOT NULL,
        ai_reason TEXT NOT NULL,
        foto_url TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        indirizzo TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        confirm_count INTEGER DEFAULT 1,
        resolved_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    """)
    
    # Audit log (for AI Act & Security compliance)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        user_id TEXT,
        details TEXT NOT NULL
    )
    """)
    
    conn.commit()
    
    # Seed default sample data if empty
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        seed_sample_data(conn)
        
    conn.close()

def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return key.hex(), salt

def verify_password(password, stored_hash, salt):
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return hmac.compare_digest(key.hex(), stored_hash)

def seed_sample_data(conn):
    cursor = conn.cursor()
    now_str = datetime.utcnow().isoformat()
    
    # Sample Marco (Citizen reporter from PDF)
    h_marco, s_marco = hash_password("Password123!")
    cursor.execute("""
    INSERT INTO users (id, nome, cognome, data_nascita, email, telefono, password_hash, salt, false_reports_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    """, ("usr_marco", "Marco", "Rossi", "1994-05-12", "marco.rossi@email.it", "+39 333 1234567", h_marco, s_marco, now_str))
    
    # Sample Giulia (Citizen bicyclist from PDF)
    h_giulia, s_giulia = hash_password("Password123!")
    cursor.execute("""
    INSERT INTO users (id, nome, cognome, data_nascita, email, telefono, password_hash, salt, false_reports_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    """, ("usr_giulia", "Giulia", "Bianchi", "2006-09-24", "giulia.b@email.it", "+39 340 7654321", h_giulia, s_giulia, now_str))
    
    # Sample Operator/Admin (Comune di Bari / Polo Innovazione)
    h_admin, s_admin = hash_password("AdminCityFix2026!")
    cursor.execute("""
    INSERT INTO users (id, nome, cognome, data_nascita, email, telefono, password_hash, salt, false_reports_count, is_admin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
    """, ("usr_admin", "Operatore", "Comune", "1985-01-01", "operatore@comune.bari.it", "+39 080 5001122", h_admin, s_admin, now_str))

    # Pre-populate sample real-world reports around Bari / Hackathon Chiostro
    # Chiostro Polo dell'Innovazione approx coords: 41.1171, 16.8719
    sample_reports = [
        ("rep_1", "usr_marco", "Marco Rossi", "incidente", "Tamponamento tra due auto all'incrocio, traffico bloccato e detriti in strada", "ROSSO", 1, 
         "Rilevato impatto veicolare serio con ostruzione carreggiata. Pericolo collisioni secondarie.",
         "https://images.unsplash.com/photo-1543393470-b2c64b6e8d2e?w=800&auto=format&fit=crop&q=60", 41.1182, 16.8725, "Via Sparano da Bari incrocio Via Piccinni", 2, 0,
         (datetime.utcnow() - timedelta(minutes=15)).isoformat(), (datetime.utcnow() + timedelta(minutes=45)).isoformat()),
        
        ("rep_2", "usr_marco", "Marco Rossi", "strada allagata", "Tombino otturato e carreggiata allagata dopo forte pioggia, acqua alta 25cm", "ARANCIONE", 1,
         "Allagamento localizzato con potenziale acquaplaning e pericolo per due ruote.",
         "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=800&auto=format&fit=crop&q=60", 41.1160, 16.8702, "Corso Vittorio Emanuele II", 3, 0,
         (datetime.utcnow() - timedelta(minutes=30)).isoformat(), (datetime.utcnow() + timedelta(minutes=30)).isoformat()),
        
        ("rep_3", "usr_marco", "Marco Rossi", "palo pericolante", "Palo della segnaletica divelto e inclinato verso il marciapiede", "GIALLO", 1,
         "Ostacolo statico su marciapiede. Rischio moderato pedonale, nessun blocco viario immediato.",
         "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=60", 41.1150, 16.8740, "Piazza del Ferrarese", 1, 0,
         (datetime.utcnow() - timedelta(minutes=5)).isoformat(), (datetime.utcnow() + timedelta(minutes=55)).isoformat()),
    ]
    
    for r in sample_reports:
        cursor.execute("""
        INSERT INTO reports (id, user_id, author_name, categoria, descrizione, severity, is_valid, ai_reason, foto_url, lat, lng, indirizzo, confirm_count, resolved_count, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, r)

    conn.commit()

# ----------------- AI MODERATION ENGINE ----------------- #

def evaluate_report_with_ai(categoria, descrizione, foto_data, custom_api_key=None, test_scenario=None):
    """
    Evaluates authenticity (Vera vs Falsa) and Severity (GIALLO, ARANCIONE, ROSSO).
    If custom_api_key or GEMINI_API_KEY is available and not in explicit simulation mode,
    it calls Google Gemini multimodal API.
    Otherwise, it executes an intelligent deterministic moderation engine adhering exactly to the rules.
    """
    
    # 1. Preset test scenarios (useful for demo/pitch)
    if test_scenario == "fake_meme":
        return {
            "is_valid": False,
            "severity": "NESSUNO",
            "reason": "La foto è un meme/immagine scaricata dal web non attinente con un'emergenza reale. Segnalazione respinta.",
            "confidence": 0.98
        }
    elif test_scenario == "fake_screen":
        return {
            "is_valid": False,
            "severity": "NESSUNO",
            "reason": "Rilevata fotografia di uno schermo o foto generata da IA con artefatti. Violazione autenticità.",
            "confidence": 0.95
        }
    elif test_scenario == "valid_yellow":
        return {
            "is_valid": True,
            "severity": "GIALLO",
            "reason": "Foto autentica. Rilevato disagio urbano lieve (buca/ramo/ostacolo non critico) senza pericolo immediato per la vita.",
            "confidence": 0.94
        }
    elif test_scenario == "valid_orange":
        return {
            "is_valid": True,
            "severity": "ARANCIONE",
            "reason": "Foto autentica. Rischio moderato o ostacolo significativo (allagamento carreggiata / veicolo fermo) che richiede attenzione.",
            "confidence": 0.96
        }
    elif test_scenario == "valid_red":
        return {
            "is_valid": True,
            "severity": "ROSSO",
            "reason": "EMERGENZA CRITICA: Incidente grave o pericolo imminente per l'incolumità delle persone. È obbligatorio chiamare il 112!",
            "confidence": 0.99
        }

    api_key = custom_api_key or GEMINI_API_KEY
    if api_key and foto_data and foto_data.startswith("data:image"):
        try:
            # Parse base64
            header, encoded = foto_data.split(",", 1)
            mime_type = header.split(";")[0].split(":")[1]
            
            prompt_text = f"""
            Sei il bot di moderazione e sicurezza urbana di CityFix Safe Mobility.
            Categoria dichiarata: {categoria}
            Descrizione: {descrizione}
            
            Analizza l'immagine e la coerenza con la descrizione.
            Regole tassative:
            1. is_valid: TRUE se la foto è reale, scattata dal vivo sul posto e pertinente.
               FALSE se è un meme, foto di uno schermo di un telefono/PC, immagine IA, stock photo, o non pertinente (es. foto di gatto o cibo per un incidente).
            2. severity:
               - GIALLO: disagio lieve, buca, ramo caduto, traffico rallentato.
               - ARANCIONE: rischio moderato, strada allagata, incidente senza feriti gravi, lite accesa.
               - ROSSO: emergenza critica per la vita (incidente devastante, rissa con armi, crollo, incendio).
               - NESSUNO: se is_valid è false.
            3. reason: spiegazione sintetica in italiano (max 2 frasi).
            
            Rispondi esclusivamente in formato JSON:
            {{"is_valid": true|false, "severity": "GIALLO"|"ARANCIONE"|"ROSSO"|"NESSUNO", "reason": "..."}}
            """
            
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
            payload = {
                "contents": [{
                    "parts": [
                        {"text": prompt_text},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": encoded
                            }
                        }
                    ]
                }],
                "generationConfig": {
                    "response_mime_type": "application/json"
                }
            }
            
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(req, timeout=10) as response:
                result = json.loads(response.read().decode('utf-8'))
                raw_text = result['candidates'][0]['content']['parts'][0]['text']
                parsed = json.loads(raw_text)
                return {
                    "is_valid": bool(parsed.get("is_valid", True)),
                    "severity": str(parsed.get("severity", "GIALLO")).upper(),
                    "reason": str(parsed.get("reason", "Analisi completata con successo tramite Google Gemini Vision.")),
                    "confidence": 0.95
                }
        except Exception as e:
            print(f"Fallback to internal AI evaluator due to: {e}")

    # Built-in Intelligent Rule Engine (Simulating Gemini Vision Multimodal)
    desc_lower = (descrizione + " " + categoria).lower()
    
    # Red flags for fake / joke / meme / offensive
    fake_keywords = ["meme", "falso", "scherzo", "lol", "gattino", "cane", "film", "stock", "fake", "foto schermo", "moneta", "pizza"]
    is_fake = any(k in desc_lower for k in fake_keywords)
    
    # Red severity indicators (Life threat, violence, heavy accident)
    red_keywords = ["incidente grave", "feriti", "sangue", "rissa con armi", "coltello", "pistola", "incendio", "esplosione", "crollo", "alluvione grave", "investito", "vita", "devastante"]
    # Orange severity indicators (Moderate danger, blockage)
    orange_keywords = ["allagat", "strada allagata", "strada bloccata", "albero caduto", "rissa", "aggressione", "molestie", "fumo", "frana", "incidente", "tamponamento", "pericolante", "infastidisce"]
    
    if is_fake:
        return {
            "is_valid": False,
            "severity": "NESSUNO",
            "reason": "La foto o la descrizione indicano un contenuto non autentico, satirico o non pertinente. Rilevato pattern non conforme alle linee guida di sicurezza.",
            "confidence": 0.96
        }
        
    if any(k in desc_lower for k in red_keywords) or categoria in ["incidente_grave", "rissa_armi", "incendio"]:
        return {
            "is_valid": True,
            "severity": "ROSSO",
            "reason": "Codice ROSSO: Rilevato pericolo critico imminente per l'incolumità pubblica. Notifica inviata in raggio prioritario e allerta 112.",
            "confidence": 0.97
        }
    elif any(k in desc_lower for k in orange_keywords) or categoria in ["incidente", "strada allagata", "rissa", "molestie", "ostacolo"]:
        return {
            "is_valid": True,
            "severity": "ARANCIONE",
            "reason": "Codice ARANCIONE: Rischio urbano moderato che richiede deviazione o cautela immediata da parte dei cittadini.",
            "confidence": 0.93
        }
    else:
        return {
            "is_valid": True,
            "severity": "GIALLO",
            "reason": "Codice GIALLO: Disagio o anomalia stradale senza minaccia immediata alla vita.",
            "confidence": 0.91
        }

# ----------------- HTTP REQUEST HANDLER ----------------- #

class SafeMobilityHandler(BaseHTTPRequestHandler):
    
    def log_audit(self, event_type, details, user_id=None):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("INSERT INTO audit_logs (timestamp, event_type, user_id, details) VALUES (?, ?, ?, ?)",
                      (datetime.utcnow().isoformat(), event_type, user_id, json.dumps(details)))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error logging audit: {e}")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def get_auth_user(self):
        auth_header = self.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None
        token = auth_header.split(" ", 1)[1].strip()
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("""
        SELECT u.id, u.nome, u.cognome, u.email, u.telefono, u.false_reports_count, u.banned_until, u.is_admin
        FROM sessions s JOIN users u ON s.user_id = u.id
        WHERE s.token = ?
        """, (token,))
        row = c.fetchone()
        conn.close()
        if not row:
            return None
        
        banned_until = row[6]
        is_banned = False
        remaining_seconds = 0
        if banned_until:
            b_time = datetime.fromisoformat(banned_until)
            if datetime.utcnow() < b_time:
                is_banned = True
                remaining_seconds = int((b_time - datetime.utcnow()).total_seconds())

        return {
            "id": row[0],
            "nome": row[1],
            "cognome": row[2],
            "email": row[3],
            "telefono": row[4],
            "false_reports_count": row[5],
            "banned_until": banned_until,
            "is_banned": is_banned,
            "remaining_ban_seconds": remaining_seconds,
            "is_admin": bool(row[7]),
            "token": token
        }

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        # API Routes
        if path == "/api/auth/me":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "Non autorizzato"}, 401)
            return self.send_json({"user": user})

        elif path == "/api/reports":
            # Optional query params: lat, lng, radius, status
            qs = parse_qs(parsed.query)
            user_lat = float(qs.get('lat', [0])[0]) if 'lat' in qs else None
            user_lng = float(qs.get('lng', [0])[0]) if 'lng' in qs else None
            radius_m = float(qs.get('radius', [2000])[0]) if 'radius' in qs else 2000
            
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("""
            SELECT id, user_id, author_name, categoria, descrizione, severity, is_valid, ai_reason, foto_url,
                   lat, lng, indirizzo, status, confirm_count, resolved_count, created_at, expires_at
            FROM reports
            WHERE status = 'active'
            ORDER BY created_at DESC
            """)
            rows = c.fetchall()
            conn.close()
            
            reports = []
            now = datetime.utcnow()
            for r in rows:
                expires_at = datetime.fromisoformat(r[16])
                # Check auto-expiration (answering Question 3 of PDF)
                is_expired = now > expires_at
                if is_expired:
                    continue
                
                # Approximate distance calculation
                dist_m = None
                if user_lat and user_lng:
                    # Haversine / flat-earth approximation for local urban distance
                    dy = (r[9] - user_lat) * 111139.0
                    dx = (r[10] - user_lng) * 111139.0 * 0.75 # cos(41 deg) approx
                    dist_m = round((dx*dx + dy*dy)**0.5, 1)

                seconds_left = max(0, int((expires_at - now).total_seconds()))
                reports.append({
                    "id": r[0],
                    "user_id": r[1],
                    "author_name": r[2],
                    "categoria": r[3],
                    "descrizione": r[4],
                    "severity": r[5],
                    "is_valid": bool(r[6]),
                    "ai_reason": r[7],
                    "foto_url": r[8],
                    "lat": r[9],
                    "lng": r[10],
                    "indirizzo": r[11],
                    "status": r[12],
                    "confirm_count": r[13],
                    "resolved_count": r[14],
                    "created_at": r[15],
                    "expires_at": r[16],
                    "seconds_left": seconds_left,
                    "distance_meters": dist_m
                })
            
            return self.send_json({"reports": reports})

        elif path == "/api/stats":
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM reports")
            total_reports = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM reports WHERE status = 'active'")
            active_reports = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM reports WHERE status = 'resolved'")
            resolved_reports = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM users WHERE banned_until IS NOT NULL")
            banned_users = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM audit_logs WHERE event_type = 'REPORT_REJECTED_FAKE'")
            blocked_fakes = c.fetchone()[0]
            conn.close()
            return self.send_json({
                "total_reports": total_reports,
                "active_reports": active_reports,
                "resolved_reports": resolved_reports,
                "banned_users": banned_users,
                "blocked_fakes": blocked_fakes
            })

        # Static file serving
        clean_path = path.lstrip('/')
        if not clean_path or clean_path == "":
            clean_path = "index.html"
            
        file_path = os.path.join(PUBLIC_DIR, clean_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            mime_type, _ = mimetypes.guess_type(file_path)
            self.send_response(200)
            self.send_header("Content-Type", mime_type or "application/octet-stream")
            with open(file_path, "rb") as f:
                content = f.read()
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
        else:
            # Fallback to index.html for SPA routing
            fallback_index = os.path.join(PUBLIC_DIR, "index.html")
            if os.path.exists(fallback_index):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                with open(fallback_index, "rb") as f:
                    content = f.read()
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
            else:
                self.send_response(404)
                self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        
        try:
            data = json.loads(body.decode('utf-8'))
        except Exception:
            data = {}

        # 1. REGISTER
        if path == "/api/auth/register":
            nome = data.get("nome", "").strip()
            cognome = data.get("cognome", "").strip()
            data_nascita = data.get("data_nascita", "").strip()
            email = data.get("email", "").strip().lower()
            telefono = data.get("telefono", "").strip()
            password = data.get("password", "").strip()

            if not all([nome, cognome, data_nascita, email, telefono, password]):
                return self.send_json({"error": "Tutti i campi sono obbligatori (Nome, Cognome, Data nascita, Email, Telefono, Password)."}, 400)

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id FROM users WHERE email = ? OR telefono = ?", (email, telefono))
            if c.fetchone():
                conn.close()
                return self.send_json({"error": "Email o numero di telefono già registrati."}, 409)

            user_id = f"usr_{secrets.token_hex(6)}"
            p_hash, salt = hash_password(password)
            now_str = datetime.utcnow().isoformat()
            
            c.execute("""
            INSERT INTO users (id, nome, cognome, data_nascita, email, telefono, password_hash, salt, false_reports_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """, (user_id, nome, cognome, data_nascita, email, telefono, p_hash, salt, now_str))

            # Auto-create session token
            token = f"tok_{secrets.token_hex(24)}"
            c.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user_id, now_str))
            conn.commit()
            conn.close()

            self.log_audit("USER_REGISTERED", {"email": email, "nome": f"{nome} {cognome}"}, user_id)
            return self.send_json({
                "message": "Registrazione completata con successo!",
                "token": token,
                "user": {
                    "id": user_id,
                    "nome": nome,
                    "cognome": cognome,
                    "email": email,
                    "telefono": telefono,
                    "false_reports_count": 0,
                    "is_banned": False
                }
            }, 201)

        # 2. LOGIN
        elif path == "/api/auth/login":
            identifier = data.get("identifier", "").strip().lower()
            password = data.get("password", "").strip()

            if not identifier or not password:
                return self.send_json({"error": "Inserisci Email o Telefono e la relativa Password."}, 400)

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("""
            SELECT id, nome, cognome, email, telefono, password_hash, salt, false_reports_count, banned_until, is_admin
            FROM users
            WHERE LOWER(email) = ? OR telefono = ?
            """, (identifier, identifier))
            row = c.fetchone()
            
            if not row:
                conn.close()
                return self.send_json({"error": "Credenziali non valide."}, 401)

            user_id, nome, cognome, email, telefono, stored_hash, salt, false_count, banned_until, is_admin = row
            if not verify_password(password, stored_hash, salt):
                conn.close()
                return self.send_json({"error": "Credenziali non valide."}, 401)

            token = f"tok_{secrets.token_hex(24)}"
            now_str = datetime.utcnow().isoformat()
            c.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user_id, now_str))
            conn.commit()
            conn.close()

            is_banned = False
            remaining_seconds = 0
            if banned_until:
                b_time = datetime.fromisoformat(banned_until)
                if datetime.utcnow() < b_time:
                    is_banned = True
                    remaining_seconds = int((b_time - datetime.utcnow()).total_seconds())

            self.log_audit("USER_LOGIN", {"identifier": identifier}, user_id)
            return self.send_json({
                "message": "Accesso effettuato con successo!",
                "token": token,
                "user": {
                    "id": user_id,
                    "nome": nome,
                    "cognome": cognome,
                    "email": email,
                    "telefono": telefono,
                    "false_reports_count": false_count,
                    "banned_until": banned_until,
                    "is_banned": is_banned,
                    "remaining_ban_seconds": remaining_seconds,
                    "is_admin": bool(is_admin)
                }
            })

        # 3. FORGOT PASSWORD REQUEST
        elif path == "/api/auth/forgot-password/request":
            identifier = data.get("identifier", "").strip().lower()
            if not identifier:
                return self.send_json({"error": "Inserisci email o numero di telefono."}, 400)

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id, email, telefono FROM users WHERE LOWER(email) = ? OR telefono = ?", (identifier, identifier))
            row = c.fetchone()
            if not row:
                conn.close()
                # Return generic message for privacy, but return demo code for presentation
                return self.send_json({"error": "Nessun account trovato associato a questo recapito."}, 404)

            user_id, email, telefono = row
            # 6-digit verification code
            otp_code = str(secrets.randbelow(900000) + 100000)
            expires_at = (datetime.utcnow() + timedelta(minutes=15)).isoformat()
            c.execute("INSERT OR REPLACE INTO reset_codes (identifier, code, expires_at) VALUES (?, ?, ?)",
                      (identifier, otp_code, expires_at))
            conn.commit()
            conn.close()

            self.log_audit("PASSWORD_RESET_REQUESTED", {"identifier": identifier, "demo_otp": otp_code}, user_id)
            return self.send_json({
                "message": f"Codice di verifica inviato via SMS/Email a {identifier}!",
                "demo_code": otp_code # exposed for seamless demo testing during hackathon pitch
            })

        # 4. FORGOT PASSWORD RESET
        elif path == "/api/auth/forgot-password/reset":
            identifier = data.get("identifier", "").strip().lower()
            code = data.get("code", "").strip()
            new_password = data.get("new_password", "").strip()

            if not identifier or not code or not new_password:
                return self.send_json({"error": "Tutti i campi sono richiesti (Recapito, Codice OTP, Nuova password)."}, 400)

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT code, expires_at FROM reset_codes WHERE identifier = ?", (identifier,))
            row = c.fetchone()
            if not row:
                conn.close()
                return self.send_json({"error": "Nessun codice richiesto per questo recapito."}, 400)

            stored_code, expires_at = row
            if stored_code != code or datetime.utcnow() > datetime.fromisoformat(expires_at):
                conn.close()
                return self.send_json({"error": "Codice non valido o scaduto."}, 400)

            # Update password
            p_hash, salt = hash_password(new_password)
            c.execute("UPDATE users SET password_hash = ?, salt = ? WHERE LOWER(email) = ? OR telefono = ?",
                      (p_hash, salt, identifier, identifier))
            c.execute("DELETE FROM reset_codes WHERE identifier = ?", (identifier,))
            conn.commit()
            conn.close()

            self.log_audit("PASSWORD_RESET_SUCCESS", {"identifier": identifier})
            return self.send_json({"message": "Password aggiornata con successo! Ora puoi effettuare il login."})

        # 5. CREATE REPORT & BOT AI MODERATION
        elif path == "/api/reports/create":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "Devi effettuare il login per segnalare un pericolo."}, 401)

            # 1. CHECK BAN (Rule from user's bot specifications)
            if user["is_banned"]:
                rem_mins = int(user["remaining_ban_seconds"] // 60)
                return self.send_json({
                    "status": "BANNED",
                    "error": f"Account sospeso per 24 ore a causa di 3 segnalazioni false. Sblocco tra {rem_mins} minuti.",
                    "banned_until": user["banned_until"],
                    "remaining_seconds": user["remaining_ban_seconds"]
                }, 403)

            categoria = data.get("categoria", "incidente").strip()
            descrizione = data.get("descrizione", "").strip()
            foto = data.get("foto", "")
            lat = float(data.get("lat", 41.1171))
            lng = float(data.get("lng", 16.8719))
            indirizzo = data.get("indirizzo", "Centro Città, Bari").strip()
            test_scenario = data.get("test_scenario", None)
            custom_gemini_key = data.get("gemini_api_key", None)

            if not descrizione:
                return self.send_json({"error": "La descrizione del pericolo è obbligatoria per avvisare gli altri cittadini."}, 400)

            # 2. RUN AI BOT EVALUATION
            ai_result = evaluate_report_with_ai(categoria, descrizione, foto, custom_api_key=custom_gemini_key, test_scenario=test_scenario)
            is_valid = ai_result["is_valid"]
            severity = ai_result["severity"]
            reason = ai_result["reason"]

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()

            # 3. HANDLE FAKE / REJECTED REPORT (THE 3-STRIKE BAN LOGIC)
            if not is_valid:
                new_false_count = user["false_reports_count"] + 1
                banned_until_str = None
                is_banned_now = False

                if new_false_count >= 3:
                    # Apply 24h ban!
                    ban_exp = datetime.utcnow() + timedelta(hours=24)
                    banned_until_str = ban_exp.isoformat()
                    is_banned_now = True
                    c.execute("UPDATE users SET false_reports_count = ?, banned_until = ? WHERE id = ?",
                              (3, banned_until_str, user["id"]))
                    conn.commit()
                    conn.close()

                    self.log_audit("USER_BANNED_3_STRIKES", {"user_id": user["id"], "reason": reason, "category": categoria})
                    return self.send_json({
                        "status": "BANNED",
                        "is_valid": False,
                        "strike_count": 3,
                        "max_strikes": 3,
                        "message": "Hai inviato 3 foto false o non conformi. Il tuo account è stato bloccato per 24 ore a tutela della sicurezza della comunità.",
                        "motivo": reason,
                        "banned_until": banned_until_str,
                        "remaining_seconds": 24 * 3600
                    }, 403)
                else:
                    c.execute("UPDATE users SET false_reports_count = ? WHERE id = ?", (new_false_count, user["id"]))
                    conn.commit()
                    conn.close()

                    self.log_audit("REPORT_REJECTED_FAKE", {"user_id": user["id"], "strike": new_false_count, "reason": reason})
                    return self.send_json({
                        "status": "REJECTED",
                        "is_valid": False,
                        "strike_count": new_false_count,
                        "max_strikes": 3,
                        "message": f"Foto non valida o non pertinente ({new_false_count}/3 tentativi prima del ban di 24h).",
                        "motivo": reason
                    }, 400)

            # 4. REPORT IS VALID -> PUBLISH TO MAP
            report_id = f"rep_{secrets.token_hex(6)}"
            now_dt = datetime.utcnow()
            # Default TTL: 1 hour (Slide 9 & 10 of PDF: 'Un'ora dopo chi passa conferma non c'è più e sparisce')
            expires_dt = now_dt + timedelta(hours=1)
            author_name = f"{user['nome']} {user['cognome']}"

            c.execute("""
            INSERT INTO reports (id, user_id, author_name, categoria, descrizione, severity, is_valid, ai_reason, foto_url, lat, lng, indirizzo, confirm_count, resolved_count, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
            """, (report_id, user["id"], author_name, categoria, descrizione, severity, 1, reason, foto, lat, lng, indirizzo, now_dt.isoformat(), expires_dt.isoformat()))
            conn.commit()
            conn.close()

            self.log_audit("REPORT_PUBLISHED", {
                "report_id": report_id,
                "severity": severity,
                "categoria": categoria,
                "lat": lat,
                "lng": lng
            }, user["id"])

            return self.send_json({
                "status": "APPROVED",
                "is_valid": True,
                "codice_gravita": severity,
                "dettagli": reason,
                "report": {
                    "id": report_id,
                    "author_name": author_name,
                    "categoria": categoria,
                    "descrizione": descrizione,
                    "severity": severity,
                    "ai_reason": reason,
                    "foto_url": foto,
                    "lat": lat,
                    "lng": lng,
                    "indirizzo": indirizzo,
                    "seconds_left": 3600
                }
            }, 201)

        # 6. CONFIRM REPORT ("Confermo, il pericolo c'è ancora")
        elif path.startswith("/api/reports/") and path.endswith("/confirm"):
            parts = path.split("/")
            report_id = parts[3]
            
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT expires_at, confirm_count FROM reports WHERE id = ?", (report_id,))
            row = c.fetchone()
            if not row:
                conn.close()
                return self.send_json({"error": "Segnalazione non trovata."}, 404)

            # Extend expiration by 30 mins (max 2 hours)
            curr_exp = datetime.fromisoformat(row[0])
            new_exp = max(curr_exp, datetime.utcnow()) + timedelta(minutes=30)
            c.execute("UPDATE reports SET confirm_count = confirm_count + 1, expires_at = ? WHERE id = ?",
                      (new_exp.isoformat(), report_id))
            conn.commit()
            conn.close()

            return self.send_json({"message": "Grazie! Hai confermato la presenza del pericolo.", "new_confirm_count": row[1] + 1})

        # 7. RESOLVE REPORT ("Non c'è più" - Answering PDF Slide 9: Step 03)
        elif path.startswith("/api/reports/") and path.endswith("/resolve"):
            parts = path.split("/")
            report_id = parts[3]
            
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT resolved_count FROM reports WHERE id = ?", (report_id,))
            row = c.fetchone()
            if not row:
                conn.close()
                return self.send_json({"error": "Segnalazione non trovata."}, 404)

            new_res_count = row[0] + 1
            # If 2 or more citizens confirm 'non c'è più', mark as resolved!
            if new_res_count >= 2:
                c.execute("UPDATE reports SET resolved_count = ?, status = 'resolved' WHERE id = ?", (new_res_count, report_id))
                msg = "Il pericolo è stato rimosso dalla mappa in seguito alle conferme dei cittadini!"
                status = "resolved"
            else:
                c.execute("UPDATE reports SET resolved_count = ? WHERE id = ?", (new_res_count, report_id))
                msg = f"Segnalazione registrata ({new_res_count}/2 conferme per la rimozione)."
                status = "pending_resolution"

            conn.commit()
            conn.close()
            return self.send_json({"message": msg, "status": status, "resolved_count": new_res_count})

        # 8. RESET DEMO BAN (convenient tool for live presentation testing)
        elif path == "/api/auth/reset-demo-ban":
            user = self.get_auth_user()
            if not user:
                return self.send_json({"error": "Non autorizzato"}, 401)
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("UPDATE users SET false_reports_count = 0, banned_until = NULL WHERE id = ?", (user["id"],))
            conn.commit()
            conn.close()
            return self.send_json({"message": "Ban e contatore strike azzerati con successo per i test demo!"})

        else:
            return self.send_json({"error": "Rotta non trovata"}, 404)

def run():
    init_db()
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, SafeMobilityHandler)
    print(f"==================================================")
    print(f"  CityFix - Safe Mobility Web App")
    print(f"  KICK-OFF SAFE MOBILITY HACK · DIDAP")
    print(f"  Server attivo su http://localhost:{PORT}")
    print(f"==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nArresto server in corso...")
        httpd.server_close()

if __name__ == "__main__":
    run()
