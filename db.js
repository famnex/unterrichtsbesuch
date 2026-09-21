const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');

let db = null;

const DEFAULT_TEMPLATES = [
    {
        id: 'ub_created_sl',
        title: 'a. Neuer UB eingereicht (an alle SL-Mitglieder)',
        description: 'Wird an alle Schulleitungsmitglieder gesendet, sobald eine Lehrkraft einen Unterrichtsbesuch einreicht.',
        subject: 'Neuer Unterrichtsbesuch eingereicht: {subject} ({grade}) - {user_name}',
        body_html: `<p>Hallo <strong>{recipient_name}</strong>,</p>
<p>die Lehrkraft <strong>{user_name}</strong> hat einen neuen Unterrichtsbesuch eingereicht:</p>
<div class="details-box">
    <div class="details-row"><div class="details-label">Lehrkraft:</div><div class="details-value">{user_name} ({user_email})</div></div>
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">{date_time} Uhr</div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
    <div class="details-row"><div class="details-label">Art:</div><div class="details-value">{type}</div></div>
    <div class="details-row"><div class="details-label">Fachleiter:</div><div class="details-value">{instructor}</div></div>
    <div class="details-row"><div class="details-label">Modul:</div><div class="details-value">{module}</div></div>
</div>
<p>Bitte prüfen Sie die Schulübersicht im Portal und übernehmen Sie die Begleitung für diesen Termin.</p>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    },
    {
        id: 'ub_created_liv',
        title: 'b. Bestätigung Einreichung mit Upload-Frist (an LiV)',
        description: 'Wird an die Lehrkraft gesendet, sobald diese einen Unterrichtsbesuch einreicht.',
        subject: 'Unterrichtsbesuch eingereicht: {subject} ({grade})',
        body_html: `<p>Hallo <strong>{user_name}</strong>,</p>
<p>Ihr Unterrichtsbesuch wurde erfolgreich im System eingereicht.</p>
<div class="details-box">
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">{date_time} Uhr</div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
    <div class="details-row"><div class="details-label">Art:</div><div class="details-value">{type}</div></div>
    <div class="details-row"><div class="details-label">Fachleiter:</div><div class="details-value">{instructor}</div></div>
    <div class="details-row"><div class="details-label">Modul:</div><div class="details-value">{module}</div></div>
</div>
<p><strong>Wichtiger Hinweis:</strong> Bitte laden Sie Ihren Unterrichtsentwurf (PDF) <strong>spätestens 1 Tag vor dem Unterrichtsbesuch</strong> im Portal hoch.</p>
<p>Sobald ein Mitglied der Schulleitung den Termin übernimmt, werden Sie automatisch per E-Mail benachrichtigt.</p>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    },
    {
        id: 'reminder_draft_liv',
        title: 'c. Erinnerung fehlender Entwurf am Vortag (an LiV - 9:00 Uhr)',
        description: 'Wird am Vortag des Unterrichtsbesuchs um 9:00 Uhr an die Lehrkraft gesendet, falls noch kein Entwurf (PDF) hochgeladen wurde.',
        subject: 'Dringende Erinnerung: Unterrichtsentwurf für {subject} ({grade}) hochladen',
        body_html: `<p>Hallo <strong>{user_name}</strong>,</p>
<p>für Ihren morgigen Unterrichtsbesuch liegt im Portal noch kein Unterrichtsentwurf vor.</p>
<div class="details-box" style="border-left-color: #f59e0b;">
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value"><strong>{date_time} Uhr (morgen)</strong></div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
    <div class="details-row"><div class="details-label">Art:</div><div class="details-value">{type}</div></div>
</div>
<p>Bitte laden Sie Ihren Entwurf (PDF) zeitnah im Portal hoch, damit sich die Schulleitung auf Ihren Besuch vorbereiten kann.</p>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    },
    {
        id: 'reminder_unassigned_sl',
        title: 'd. Erinnerung nicht zugewiesener UB am Vortag (an alle SL-Mitglieder - 9:00 Uhr)',
        description: 'Wird am Vortag des Unterrichtsbesuchs um 9:00 Uhr an alle Schulleitungsmitglieder gesendet, falls der Termin noch nicht zugewiesen wurde.',
        subject: 'Dringend: Noch keine Begleitung für morgigen UB von {user_name} ({subject})',
        body_html: `<p>Hallo <strong>{recipient_name}</strong>,</p>
<p>für den morgigen Unterrichtsbesuch der Lehrkraft <strong>{user_name}</strong> ist bisher noch keine Schulleitungsbegleitung eingetragen:</p>
<div class="details-box" style="border-left-color: #f59e0b;">
    <div class="details-row"><div class="details-label">Lehrkraft:</div><div class="details-value">{user_name} ({user_email})</div></div>
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value"><strong>{date_time} Uhr (morgen)</strong></div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
    <div class="details-row"><div class="details-label">Art:</div><div class="details-value">{type}</div></div>
</div>
<p>Bitte öffnen Sie das Portal und übernehmen Sie die Begleitung für diesen Termin.</p>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    },
    {
        id: 'reminder_upcoming_sl',
        title: 'e. Terminerinnerung an Begleitung am Vortag (an zugewiesene SL - 10:00 Uhr)',
        description: 'Wird am Vortag des Unterrichtsbesuchs um 10:00 Uhr an das zugewiesene Schulleitungsmitglied als Erinnerung gesendet.',
        subject: 'Erinnerung: Morgen Unterrichtsbesuch bei {user_name} ({subject})',
        body_html: `<p>Hallo <strong>{recipient_name}</strong>,</p>
<p>Sie sind für morgen als Begleitung für den folgenden Unterrichtsbesuch eingetragen:</p>
<div class="details-box">
    <div class="details-row"><div class="details-label">Lehrkraft:</div><div class="details-value">{user_name} ({user_email})</div></div>
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value"><strong>{date_time} Uhr (morgen)</strong></div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
    <div class="details-row"><div class="details-label">Art:</div><div class="details-value">{type}</div></div>
    <div class="details-row"><div class="details-label">Fachleiter:</div><div class="details-value">{instructor}</div></div>
    <div class="details-row"><div class="details-label">Modul:</div><div class="details-value">{module}</div></div>
</div>
<p>Den aktuellen Entwurf können Sie direkt im Portal einsehen.</p>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    },
    {
        id: 'ub_assigned_sl',
        title: 'f. Terminbegleitung zugewiesen (an Schulleitungsmitglied mit iCal)',
        description: 'Wird an das Schulleitungsmitglied gesendet, wenn diesem ein Unterrichtsbesuch zugewiesen wird (inkl. Outlook-Kalendereinladung).',
        subject: 'Begleitung Unterrichtsbesuch: {subject} ({grade}) - {user_name}',
        body_html: `<p>Hallo <strong>{recipient_name}</strong>,</p>
<p>Sie wurden als Begleitung für den folgenden Unterrichtsbesuch eingetragen bzw. haben diesen übernommen:</p>
<div class="details-box">
    <div class="details-row"><div class="details-label">Lehrkraft:</div><div class="details-value">{user_name} ({user_email})</div></div>
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">{date_time} Uhr</div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
    <div class="details-row"><div class="details-label">Art:</div><div class="details-value">{type}</div></div>
    <div class="details-row"><div class="details-label">Fachleiter:</div><div class="details-value">{instructor}</div></div>
    <div class="details-row"><div class="details-label">Modul:</div><div class="details-value">{module}</div></div>
</div>
<p>Outlook und andere Mail-Clients zeigen Ihnen diesen Termin oben als interaktive Kalendereinladung (Zusagen/Ablehnen) an.</p>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    },
    {
        id: 'ub_assigned_liv',
        title: 'g. Begleitungs-Info (an LiV)',
        description: 'Wird an die Lehrkraft gesendet, sobald ein Schulleitungsmitglied den Termin übernimmt.',
        subject: 'Begleitung für Ihren Unterrichtsbesuch am {date_time}',
        body_html: `<p>Hallo <strong>{user_name}</strong>,</p>
<p>Ihr Unterrichtsbesuch wird von folgender Person begleitet:</p>
<div class="details-box">
    <div class="details-row"><div class="details-label">Begleitung:</div><div class="details-value"><strong>{sl_name}</strong> ({sl_email})</div></div>
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">{date_time} Uhr</div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
</div>
<p>Bitte stellen Sie sicher, dass Ihr Unterrichtsentwurf (PDF) rechtzeitig im Portal hochgeladen wird.</p>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    },
    {
        id: 'ub_cancelled_liv',
        title: 'h. Bestätigung Absage (an LiV)',
        description: 'Wird an die Lehrkraft gesendet, wenn diese einen Unterrichtsbesuch absagt.',
        subject: 'Bestätigung: Unterrichtsbesuch abgesagt am {date_time}',
        body_html: `<p>Hallo <strong>{user_name}</strong>,</p>
<p>Ihr Unterrichtsbesuch wurde erfolgreich im System abgesagt.</p>
<div class="details-box" style="border-left-color: #e53e3e;">
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">{date_time} Uhr</div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Art:</div><div class="details-value">{type}</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
</div>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    },
    {
        id: 'ub_cancelled_sl',
        title: 'i. Hinweis Absage (an Schulleitungsmitglied mit Storno-iCal)',
        description: 'Wird an das zugewiesene Schulleitungsmitglied gesendet, wenn ein Unterrichtsbesuch abgesagt wird (inkl. Kalenderstornierung).',
        subject: 'ABGESAGT: Begleitung Unterrichtsbesuch {user_name}',
        body_html: `<p>Hallo <strong>{recipient_name}</strong>,</p>
<p>der folgende Termin, für den Sie als Begleitung eingetragen waren, wurde von der Lehrkraft abgesagt:</p>
<div class="details-box" style="border-left-color: #e53e3e;">
    <div class="details-row"><div class="details-label">Lehrkraft:</div><div class="details-value">{user_name} ({user_email})</div></div>
    <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">{date_time} Uhr</div></div>
    <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">{subject} (Klasse {grade})</div></div>
    <div class="details-row"><div class="details-label">Art:</div><div class="details-value">{type}</div></div>
    <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">{room}</div></div>
</div>
<p>Der Termin wurde in Ihrem Kalender-Workflow storniert.</p>
<p>Freundliche Grüße,<br>Ihr Unterrichtsbesuchs-Portal</p>`
    }
];

async function getDatabase() {
    if (db) return db;

    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Foreign Keys aktivieren
    await db.run('PRAGMA foreign_keys = ON;');

    // Tabellen initialisieren
    await db.exec(`
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

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            display_name TEXT,
            email TEXT,
            role TEXT DEFAULT 'user'
        );

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
            reminded_draft_liv INTEGER DEFAULT 0,
            reminded_unassigned_sl INTEGER DEFAULT 0,
            reminded_upcoming_sl INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(assigned_schulleitung_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS mail_templates (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            body_html TEXT NOT NULL,
            description TEXT
        );
    `);

    // Migration 1: Prüfen, ob logout_redirect_url Spalte in settings existiert
    const settingsColumns = await db.all("PRAGMA table_info(settings)");
    const hasLogoutUrl = settingsColumns.some(c => c.name === 'logout_redirect_url');
    if (!hasLogoutUrl) {
        await db.run("ALTER TABLE settings ADD COLUMN logout_redirect_url TEXT DEFAULT '';");
        console.log("Datenbank-Migration: Spalte logout_redirect_url zur Tabelle settings hinzugefügt.");
    }

    // Migration 2: Erinnerungs-Flags in unterrichtsbesuche prüfen
    const ubColumns = await db.all("PRAGMA table_info(unterrichtsbesuche)");
    const colNames = ubColumns.map(c => c.name);

    if (!colNames.includes('reminded_draft_liv')) {
        await db.run("ALTER TABLE unterrichtsbesuche ADD COLUMN reminded_draft_liv INTEGER DEFAULT 0;");
        console.log("Datenbank-Migration: Spalte reminded_draft_liv hinzugefügt.");
    }
    if (!colNames.includes('reminded_unassigned_sl')) {
        await db.run("ALTER TABLE unterrichtsbesuche ADD COLUMN reminded_unassigned_sl INTEGER DEFAULT 0;");
        console.log("Datenbank-Migration: Spalte reminded_unassigned_sl hinzugefügt.");
    }
    if (!colNames.includes('reminded_upcoming_sl')) {
        await db.run("ALTER TABLE unterrichtsbesuche ADD COLUMN reminded_upcoming_sl INTEGER DEFAULT 0;");
        console.log("Datenbank-Migration: Spalte reminded_upcoming_sl hinzugefügt.");
    }

    // Standardeintrag in settings erzeugen, falls nicht vorhanden
    const settingsExist = await db.get('SELECT id FROM settings WHERE id = 1');
    if (!settingsExist) {
        await db.run(`
            INSERT INTO settings (id, jwt_secret, jwt_claim_username, jwt_claim_name, jwt_claim_email, is_setup_completed, logout_redirect_url)
            VALUES (1, '', 'username', 'name', 'email', 0, '')
        `);
    }

    // Standard-Mailvorlagen einfügen oder ergänzen, falls noch nicht vorhanden
    for (const t of DEFAULT_TEMPLATES) {
        const exists = await db.get('SELECT id FROM mail_templates WHERE id = ?', [t.id]);
        if (!exists) {
            await db.run(
                'INSERT INTO mail_templates (id, title, subject, body_html, description) VALUES (?, ?, ?, ?, ?)',
                [t.id, t.title, t.subject, t.body_html, t.description]
            );
            console.log(`Datenbank-Migration: Standard-E-Mailvorlage "${t.id}" angelegt.`);
        }
    }

    return db;
}

module.exports = {
    getDatabase,
    DEFAULT_TEMPLATES
};
