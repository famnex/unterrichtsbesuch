const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');

let db = null;

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
            is_setup_completed INTEGER DEFAULT 0
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
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(assigned_schulleitung_id) REFERENCES users(id)
        );
    `);

    // Migration: Prüfen, ob logout_redirect_url Spalte in settings existiert
    const columns = await db.all("PRAGMA table_info(settings)");
    const hasLogoutUrl = columns.some(c => c.name === 'logout_redirect_url');
    if (!hasLogoutUrl) {
        await db.run("ALTER TABLE settings ADD COLUMN logout_redirect_url TEXT DEFAULT '';");
        console.log("Datenbank-Migration: Spalte logout_redirect_url zur Tabelle settings hinzugefügt.");
    }

    // Standardeintrag in settings erzeugen, falls nicht vorhanden
    const settingsExist = await db.get('SELECT id FROM settings WHERE id = 1');
    if (!settingsExist) {
        await db.run(`
            INSERT INTO settings (id, jwt_secret, jwt_claim_username, jwt_claim_name, jwt_claim_email, is_setup_completed, logout_redirect_url)
            VALUES (1, '', 'username', 'name', 'email', 0, '')
        `);
    }

    return db;
}

module.exports = {
    getDatabase
};
