# Unterrichtsbesuche-Verwaltungs-App

Eine moderne Full-Stack-Webanwendung zur komfortablen Verwaltung von Unterrichtsbesuchen (UB) für Lehrkräfte (LiV) und Schulleitungen (SL).

## Features

- **First-Run-Setup:** Initialer Einrichtungsmodus bei Erststart (SMTP-Konfiguration & JWT-Claim-Mapping).
- **Rollenbasiertes Rechtesystem:**
  - **Lehrkräfte (LiV):** Dashboard für zukünftige Unterrichtsbesuche, Anträge erstellen/bearbeiten, PDF-Entwürfe nachträglich hochladen/ersetzen, Archivansicht.
  - **Schulleitung (SL):** Gesamtübersicht aller eingereichten UBs, Zuordnung/Übernahme von Terminen als Begleitung.
  - **Administratoren:** Zugriff auf das Einstellungs-Backend und das Benutzermanagement (Rollenverwaltung).
- **Automatisierter E-Mail- & iCal-Workflow:**
  - E-Mail-Bestätigung nach dem Einreichen eines UBs.
  - iCal-Kalenderdatei (`.ics` Anhang) an E-Mails für die Schulleitung zur direkten Übernahme in Outlook, Apple Calendar, etc.
  - Benachrichtigungs-E-Mails an Lehrkräfte nach erfolgter Zuordnung.
- **Dynamisches JWT-Claim-Mapping:** Flexibel anpassbares Mapping für ankommende JWT-Claims (z. B. Username, Name, E-Mail).

## Installation & Start

1. Repository klonen oder herunterladen.
2. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
3. Anwendung starten:
   - **Produktion:**
     ```bash
     npm start
     ```
   - **Entwicklung:**
     ```bash
     npm run dev
     ```
4. Die App läuft standardmäßig auf [http://localhost:3000](http://localhost:3000).

## Systemstart & Ersteinrichtung

1. Beim allerersten Aufruf ohne registrierte Benutzer schaltet die Anwendung automatisch in den **Setup-Modus**.
2. Der allererste Benutzer, der sich erfolgreich über das JWT authentifiziert, wird in der Datenbank automatisch mit der Rolle **Administrator** angelegt und zur globalen Setup-Seite geleitet.
3. Nach der Angabe von SMTP-Daten und dem JWT-Claim-Mapping wird das System freigegeben.

## Datenbank-Layout

Details zum Datenbankschema finden Sie in der [db.md](db.md). Zur Abfrage der Datenbank kann das mitgelieferte Skript genutzt werden (z. B. `node scripts/query_db.js "SELECT * FROM users"`).

## Lizenz

ISC
