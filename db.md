# Datenbankstruktur

Diese Datei dokumentiert das Datenbankschema für die Unterrichtsbesuche-Verwaltungs-App. Die Datenbank wird als SQLite-Datei (`database.sqlite`) im Hauptverzeichnis des Projekts gespeichert.

## Tabellenschemata

### 1. `settings`
Speichert die globalen Anwendungskonfigurationen und SMTP-Einstellungen.

| Spalte | Typ | Beschreibung |
| :--- | :--- | :--- |
| `id` | INTEGER PRIMARY KEY | Eindeutige ID (immer 1 für Single-Configuration) |
| `smtp_host` | TEXT | Hostname des SMTP-Servers |
| `smtp_port` | INTEGER | Port des SMTP-Servers |
| `smtp_user` | TEXT | Benutzername für SMTP |
| `smtp_pass` | TEXT | Passwort für SMTP |
| `smtp_from` | TEXT | Absender-E-Mail-Adresse |
| `jwt_secret` | TEXT | Secret oder Public Key für die Signaturprüfung des JWT (optional, falls ein Proxy validiert) |
| `jwt_claim_username` | TEXT | Claim-Name im JWT für den Benutzernamen (z.B. `preferred_username` oder `sub`) |
| `jwt_claim_name` | TEXT | Claim-Name im JWT für den Klarnamen (z.B. `name` oder `displayName`) |
| `jwt_claim_email` | TEXT | Claim-Name im JWT für die E-Mail-Adresse (z.B. `email`) |
| `is_setup_completed` | INTEGER | Flag, ob das First-Run-Setup abgeschlossen ist (`0` = Nein, `1` = Ja) |
| `logout_redirect_url` | TEXT | Weiterleitungs-URL nach dem Abmelden (z. B. SSO-Logout des Identity Providers) |

```sql
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    smtp_host TEXT,
    smtp_port INTEGER,
    smtp_user TEXT,
    smtp_pass TEXT,
    smtp_from TEXT,
    jwt_secret TEXT,
    jwt_claim_username TEXT DEFAULT 'username',
    jwt_claim_name TEXT DEFAULT 'name',
    jwt_claim_email TEXT DEFAULT 'email',
    is_setup_completed INTEGER DEFAULT 0,
    logout_redirect_url TEXT DEFAULT ''
);
```

### 2. `users`
Speichert alle bekannten Benutzer, die sich über den Identity Provider authentifiziert haben.

| Spalte | Typ | Beschreibung |
| :--- | :--- | :--- |
| `id` | TEXT PRIMARY KEY | Eindeutige ID des Benutzers (meist der `sub` oder `uid` Claim aus dem JWT) |
| `username` | TEXT | Eindeutiger Benutzername |
| `display_name` | TEXT | Klarname des Benutzers |
| `email` | TEXT | E-Mail-Adresse des Benutzers |
| `role` | TEXT | Rolle des Benutzers: `user` (Lehrkraft), `schulleitung` oder `admin` |

```sql
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    role TEXT DEFAULT 'user'
);
```

### 3. `unterrichtsbesuche`
Speichert die geplanten und durchgeführten Unterrichtsbesuche.

| Spalte | Typ | Beschreibung |
| :--- | :--- | :--- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Eindeutige ID des Unterrichtsbesuchs |
| `date_time` | TEXT | Datum und Uhrzeit des Besuchs (ISO 8601 Format oder YYYY-MM-DD HH:MM) |
| `room` | TEXT | Klassenzimmer |
| `subject` | TEXT | Unterrichtsfach |
| `grade` | TEXT | Klasse / Lerngruppe |
| `type` | TEXT | Art des Besuchs (z.B. "Unterrichtsbesuch", "Examen") |
| `instructor` | TEXT | Name des zuständigen Fachleiters |
| `module` | TEXT | Ausbildungsmodul |
| `file_path` | TEXT | Dateipfad des hochgeladenen Unterrichtsentwurfs (PDF) |
| `user_id` | TEXT | Fremdschlüssel auf `users.id` (Ersteller des UBs) |
| `assigned_schulleitung_id` | TEXT | Fremdschlüssel auf `users.id` (Begleitendes Schulleitungsmitglied, optional) |
| `status` | TEXT | Aktueller Status: `draft` (Entwurf), `submitted` (Eingereicht), `cancelled` (Abgesagt), `archived` (Archiviert) |
| `created_at` | TEXT | Erstellungszeitstempel |
| `updated_at` | TEXT | Letzter Änderungszeitstempel |

```sql
CREATE TABLE IF NOT EXISTS unterrichtsbesuche (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_time TEXT NOT NULL,
    room TEXT NOT NULL,
    subject TEXT NOT NULL,
    grade TEXT NOT NULL,
    type TEXT NOT NULL,
    instructor TEXT,
    module TEXT,
    file_path TEXT,
    user_id TEXT NOT NULL,
    assigned_schulleitung_id TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(assigned_schulleitung_id) REFERENCES users(id)
);
```

## Änderungen und Historie
- **2026-07-17:** Initiale Tabellenstruktur definiert. Feld `jwt_secret` zu `settings` hinzugefügt.
- **2026-07-17 (Update 2):** Feld `logout_redirect_url` zur Tabelle `settings` hinzugefügt.
- **2026-07-17 (Update 3):** Status `cancelled` (Abgesagt) für Unterrichtsbesuche dokumentiert.
