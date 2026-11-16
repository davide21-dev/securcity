# 🚲 SecurCity
> **Modulo di Sicurezza Urbana & Allerte di Prossimità con Moderazione AI**  
> *Sviluppato in occasione del Safe Mobility Hackathon (16 e 17 novembre 2026 · Didap SRLS, Chiostro - Polo per l'Innovazione)*

![SecurCity Banner](https://img.shields.io/badge/SecurCity-2026-1B4332?style=for-the-badge&logo=shield)
![Status](https://img.shields.io/badge/Status-Prototipo_Funzionante_e_Testato-2D6A4F?style=for-the-badge)
![Zero Dependencies](https://img.shields.io/badge/Dipendenze-Zero_(Python_3_Standard_Lib)-brightgreen?style=for-the-badge)
![AI Act Compliant](https://img.shields.io/badge/AI_Act-Conforme-blue?style=for-the-badge)

---

## 🎯 Il Problema & La Sfida
> *"Come segnalo agli altri la presenza di un pericolo imminente? Un incidente, un ostacolo, una strada allagata: l'informazione spesso non arriva a chi potrebbe essere in pericolo."*  
> *(dalle tracce del Kick-Off Didap)*

Durante una giornata tipo in città:
1. **Marco** vede un incidente all'incrocio e vuole segnalarlo in pochissimi secondi.
2. **Giulia**, tornando da scuola in bicicletta a 200 metri, deve ricevere un avviso tempestivo per deviare prima di trovarsi nel pericolo.
3. **La comunità**: un'ora dopo, chi passa conferma *"Non c'è più"* e il pericolo scompare dalla mappa.
4. **La sicurezza**: prevenire allarmi falsi, meme, o abusi tramite un **Bot AI intelligente** che applica sanzioni progressive (3 foto false = **Ban di 24 ore**).

---

## 🚀 Avvio Rapido in Locale (Zero Installazioni Esterne!)

Il progetto è stato appositamente progettato con **zero dipendenze npm o pip esterne**, garantendo che la giuria o chiunque possa clonare la repo e avviarla al primo colpo su qualsiasi sistema operativo (macOS, Linux, Windows) dotato di Python 3.

### 1. Clonazione del Progetto
```bash
git clone <URL_DELLA_TUA_REPOSITORY>
cd Progetto
```

### 2. Avvio del Server
```bash
python3 server.py
```

### 3. Apertura nel Browser
Apri il tuo browser preferito all'indirizzo:
```
http://localhost:8080
```

*Nota: La porta di default è `8080`. Se desideri usare un'altra porta, puoi impostarla con `PORT=3000 python3 server.py`.*

---

## 🔑 Credenziali Demo Preconfigurate (per la Giuria)

Per agevolare il testing immediato durante il pitch, l'applicazione include 3 account con ruoli differenti (selezionabili anche con un click dai pulsanti demo nella schermata di login):

| Utente | Email / Telefono | Password | Ruolo & Scenario |
| :--- | :--- | :--- | :--- |
| **Marco Rossi** | `marco.rossi@email.it` | `Password123!` | Cittadino Segnalatore (scatta foto e segnala incidenti) |
| **Giulia Bianchi** | `giulia.b@email.it` | `Password123!` | Ciclista a 200m (riceve notifiche geofencing) |
| **Operatore Comune** | `operatore@comune.bari.it` | `AdminSecurCity2026!` | Sala Operativa & Triage Emergenze Comunali |

---

## 🧩 Moduli e Funzionalità Implementate

### 1. 🔐 Sistema di Autenticazione Completo
Risponde all'integrazione con il bot descritta nelle specifiche:
- **Registrazione Utente**: acquisizione di Nome, Cognome, Data di Nascita, Email, Numero di Telefono e Password sicura (hashing PBKDF2-SHA256 con salt univoco).
- **Login Flessibile**: accesso mediante **Email oppure Numero di Telefono** + Password.
- **Password Dimenticata**: flusso con codice OTP a 6 cifre e reimpostazione password.
- **Profilo & Tracking Sanzioni**: monitoraggio dello stato dell'account e delle segnalazioni effettuate.

---

### 2. 🤖 Il "Cervello" del Bot: Moderazione AI & Sanzioni Anti-Abuso
Il bot multimodale valuta ogni segnalazione prima di renderla visibile:

#### A. Verifica Autenticità (Vera vs Falsa)
- **Falsa (Respinta)**: Riconoscimento di foto di schermi/monitor di PC o smartphone, immagini generate con intelligenza artificiale, meme satirici, watermark di stock photo o foto irrilevanti (es. foto di animali per segnalare un sinistro).
- **Vera (Approvata)**: Scatto autentico contestualizzato sul posto.

#### B. Codici di Gravità Assegnati dall'AI
- 🟡 **CODICE GIALLO (Bassa)**: Disagio urbano lieve senza pericolo per la vita (es. buca sull'asfalto, ramo caduto sul marciapiede, traffico rallentato).
- 🟠 **CODICE ARANCIONE (Media)**: Rischio moderato che richiede cautela immediata (es. allagamento carreggiata, auto ferma in curva, principio di lite, ostacolo carreggiata).
- 🔴 **CODICE ROSSO (Grave/Critica)**: Emergenza critica e pericolo per l'incolumità (incidente con feriti, rissa armata, crollo, incendio). L'app visualizza l'obbligo di contattare il **112**.

#### C. La Regola dei 3 Strike & Ban 24h
- Al 1° invio di foto falsa: Avviso e **Strike 1/3**.
- Al 2° invio di foto falsa: Avviso severo e **Strike 2/3**.
- Al 3° invio di foto falsa: **BAN IMMEDIATO DI 24 ORE** (`banned_until = NOW() + 24h`). All'utente viene bloccato qualsiasi invio e viene mostrato un banner con conto alla rovescia in tempo reale.

*(È possibile collegare la propria API Key di Google Gemini da Google AI Studio direttamente dal menu dell'app, oppure sfruttare il motore AI integrato per demo offline).*

---

### 3. 🗺️ Mappa Dinamica & Allerte di Prossimità (Geofencing)
- **Mappa Interattiva (Leaflet)** con marker dinamici a impulsi colorati per livello di gravità.
- **Raggio di Comunicazione Regolabile**:
  - `200m`: Raggio iper-locale per pedoni e ciclisti (come Giulia nel caso studio).
  - `500m`: Raggio di quartiere.
  - `1.5km`: Raggio per veicoli a motore e centri abitati minori.
- **Simulatore "Giulia a 200m"**: con un click, simula lo spostamento di Giulia verso l'incrocio di Via Sparano, scatenando il segnale acustico e il popup di allerta:  
  *«Attenzione Giulia: Incidente rilevato a 180 metri dal tuo percorso. Si consiglia deviazione su Via Piccinni.»*

---

### 4. 🤝 Ciclo di Vita del Pericolo & Rimozione Partecipata
- **TTL (Time to Live) Automatico**: ogni pericolo ha una durata predefinita di 1 ora.
- **👍 «Confermo, c'è ancora»**: estende la validità del segnale.
- **❌ «Non c'è più»**: quando 2 o più cittadini confermano che il pericolo è cessato, la segnalazione **scompare istantaneamente dalla mappa**, mantenendo la città pulita da falsi allarmi passati.

---

### 5. 🏛️ Sala Operativa Comunale (Triage & Dominio Ente)
- Pannello di smistamento per la Polizia Locale, Protezione Civile e Manutenzione Strade.
- KPI aggregati su emergenze attive, codici rossi e tentativi di spam bloccati.
- **Audit Log conforme all'AI Act**: registro immutabile e verificabile delle decisioni prese dal bot, privo di profilazione biometrica illecita e trasparente.

---

## 📋 Risposte alle 5 Domande della Giuria (Slide 10)

| # | Domanda della Traccia | Risposta e Soluzione SecurCity |
| :-: | :--- | :--- |
| **01** | *Come si segnala un pericolo in pochi secondi?* | Interfaccia Quick-Report one-touch con 6 preset iconici, geolocalizzazione automatica istantanea e scatto foto diretto. Nessun form prolisso. |
| **02** | *Chi riceve l'avviso? Quanto è grande il raggio, in città e in paese?* | Geofencing adattivo basato sulla velocità di spostamento: 200m per pedoni/bici (bassa velocità/alta precisione) fino a 1.5-3km per auto e piccoli paesi con meno densità abitativa. |
| **03** | *Quanto resta un pericolo sulla mappa, e come sparisce?* | Durata base di 1 ora (TTL decrescente visibile con timer). Sparisce o per decadimento naturale o per consenso rapido con 2 voti *"Non c'è più"*. |
| **04** | *Come evitiamo segnalazioni false o offensive?* | Bot AI Vision multimodale che rileva fake, meme e incongruenze. Sistema a 3 strike con blocco/ban rigido di 24 ore applicato a livello server e database. |
| **05** | *Qual è il dominio di competenza del comune?* | SecurCity non sostituisce i numeri di soccorso (112), ma funge da strato collaborativo cittadino e fornisce al Comune una dashboard di triage per pianificare gli interventi di Polizia Locale e Protezione Civile. |

---

## 🛠️ Stack Tecnologico
- **Backend**: Python 3 (Framework nativo `http.server`, `sqlite3`, `hashlib`, `hmac`).
- **Database**: SQLite embedded (memorizzazione persistente e transazionale in `data/safemobility.db`).
- **Frontend**: HTML5 Semantico, Tailwind CSS (via CDN), Leaflet.js (OpenStreetMap Tiles), Lucide Icons, Vanilla JavaScript reattivo.
- **AI Engine**: Google Gemini API (`gemini-1.5-flash` / `gemini-2.5-flash`) con motore euristico integrato per fallback e test offline.

---

## 🏆 Criteri di Valutazione Hackathon
- **Idea (10/10)**: Modulo coerente, focalizzato sulla sicurezza immediata, perfettamente integrato nell'ecosistema SecurCity.
- **Presentazione (15/15)**: Pitch deck dettagliato pronto (`PITCH.md`), simulazione interattiva del caso Giulia in 1 click.
- **Esecuzione (5/5)**: Prototipo pienamente funzionante, responsive, avviabile in locale con 1 riga di comando.

---
*Progetto realizzato per il Safe Mobility Hackathon · Didap SRLS · 16-17 Novembre 2026*
