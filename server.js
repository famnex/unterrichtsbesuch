const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { getDatabase } = require('./db');
const { sendUBSubmittedMail, sendUBAssignedMails } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3022;
const BASE_PATH = '/unterrichtsbesuch';

// Ordner für Uploads erstellen, falls nicht vorhanden
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Konfiguration für PDF Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'entwurf-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Nur PDF-Dateien sind erlaubt!'), false);
        }
    }
});

// Router für den Unterpfad erstellen
const router = express.Router();

router.use(express.json());

// Middleware zur Authentifizierung und JWT Claim-Mapping
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Kein Token bereitgestellt' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const db = await getDatabase();
        const settings = await db.get('SELECT * FROM settings WHERE id = 1');

        let decoded;
        if (settings.jwt_secret) {
            try {
                decoded = jwt.verify(token, settings.jwt_secret);
            } catch (err) {
                let errorMsg = 'Ungültiges JWT (Verifizierung fehlgeschlagen)';
                if (err.name === 'TokenExpiredError') {
                    errorMsg = 'JWT ist abgelaufen (Session abgelaufen)';
                } else if (err.name === 'JsonWebTokenError') {
                    errorMsg = 'JWT-Signaturprüfung fehlgeschlagen. Stimmt das Secret in den Einstellungen?';
                }
                return res.status(401).json({ error: errorMsg });
            }
        } else {
            // Signaturprüfung überspringen (Proxy hat das bereits erledigt)
            decoded = jwt.decode(token);
            if (!decoded) {
                return res.status(401).json({ error: 'Token konnte nicht als JWT dekodiert werden (falsches Format)' });
            }
        }

        // Dynamisches Claim-Mapping
        const claimUsernameKey = settings.jwt_claim_username || 'username';
        const claimNameKey = settings.jwt_claim_name || 'name';
        const claimEmailKey = settings.jwt_claim_email || 'email';

        const username = decoded[claimUsernameKey] || decoded.username || decoded.sub;
        const displayName = decoded[claimNameKey] || decoded.name || decoded.displayName || username;
        const email = decoded[claimEmailKey] || decoded.email;
        const id = decoded.sub || username; // sub ist Standard-ID in OIDC, Fallback auf username

        if (!username) {
            return res.status(400).json({ error: 'JWT enthält keinen gültigen Benutzernamen-Claim' });
        }

        // Prüfen, ob dies der allererste Benutzer im System ist
        const userCountObj = await db.get('SELECT COUNT(*) as count FROM users');
        const isFirstUser = userCountObj.count === 0;

        // Benutzer in DB suchen oder anlegen
        let user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
        if (!user) {
            const role = isFirstUser ? 'admin' : 'user';
            await db.run(
                'INSERT INTO users (id, username, display_name, email, role) VALUES (?, ?, ?, ?, ?)',
                [id, username, displayName, email, role]
            );
            user = { id, username, display_name: displayName, email, role };
            console.log(`Neuer Benutzer registriert: ${username} als ${role}`);
        }

        req.user = user;
        req.settings = settings;
        next();
    } catch (err) {
        console.error('Auth-Middleware Fehler:', err);
        res.status(500).json({ error: 'Interner Serverfehler bei der Authentifizierung' });
    }
}

// API: Setup Status (ungeschützt für den First-Run Check)
router.get('/api/setup-status', async (req, res) => {
    try {
        const db = await getDatabase();
        const settings = await db.get('SELECT is_setup_completed, logout_redirect_url FROM settings WHERE id = 1');
        res.json({
            is_setup_completed: settings ? !!settings.is_setup_completed : false,
            logout_redirect_url: settings ? settings.logout_redirect_url || '' : ''
        });
    } catch (err) {
        console.error('Fehler beim Abrufen des Setup-Status:', err);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// API: Aktueller Benutzer & Setup Status
router.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({
        user: req.user,
        is_setup_completed: !!req.settings.is_setup_completed
    });
});

// API: Settings abrufen
router.get('/api/settings', async (req, res, next) => {
    try {
        const db = await getDatabase();
        const settings = await db.get('SELECT is_setup_completed FROM settings WHERE id = 1');
        if (!settings || settings.is_setup_completed === 0) {
            // First-run setup: Keine Authentifizierung erforderlich, um leere Settings abzurufen
            return next();
        }
        // Regulärer Schutz nach abgeschlossenem Setup
        authMiddleware(req, res, next);
    } catch (err) {
        res.status(500).json({ error: 'Fehler bei der Setup-Prüfung' });
    }
}, async (req, res) => {
    const db = await getDatabase();
    const settings = await db.get('SELECT * FROM settings WHERE id = 1');
    if (settings) {
        // Passwort nicht im Klartext zurückgeben (Sicherheitsmaßnahme)
        settings.smtp_pass = settings.smtp_pass ? '********' : '';
    }
    res.json(settings);
});

// API: Settings speichern
router.post('/api/settings', async (req, res, next) => {
    try {
        const db = await getDatabase();
        const settings = await db.get('SELECT is_setup_completed FROM settings WHERE id = 1');
        if (!settings || settings.is_setup_completed === 0) {
            // First-run setup: Keine Authentifizierung erforderlich, um das Setup zu speichern
            return next();
        }
        // Regulärer Schutz nach abgeschlossenem Setup (Nur Admins)
        authMiddleware(req, res, (err) => {
            if (err) return next(err);
            if (req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Keine Berechtigung' });
            }
            next();
        });
    } catch (err) {
        res.status(500).json({ error: 'Fehler bei der Setup-Prüfung' });
    }
}, async (req, res) => {
    const {
        smtp_host,
        smtp_port,
        smtp_user,
        smtp_pass,
        smtp_from,
        jwt_secret,
        jwt_claim_username,
        jwt_claim_name,
        jwt_claim_email,
        logout_redirect_url
    } = req.body;

    const db = await getDatabase();
    
    // SMTP-Passwort-Schutz (falls '********', behalten wir das alte Passwort)
    let finalPass = smtp_pass;
    if (smtp_pass === '********') {
        const oldSettings = await db.get('SELECT smtp_pass FROM settings WHERE id = 1');
        finalPass = oldSettings ? oldSettings.smtp_pass : '';
    }

    await db.run(`
        UPDATE settings
        SET smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?, smtp_from = ?,
            jwt_secret = ?, jwt_claim_username = ?, jwt_claim_name = ?, jwt_claim_email = ?,
            logout_redirect_url = ?,
            is_setup_completed = 1
        WHERE id = 1
    `, [
        smtp_host || '',
        smtp_port ? parseInt(smtp_port, 10) : null,
        smtp_user || '',
        finalPass || '',
        smtp_from || '',
        jwt_secret || '',
        jwt_claim_username || 'username',
        jwt_claim_name || 'name',
        jwt_claim_email || 'email',
        logout_redirect_url || ''
    ]);

    res.json({ message: 'Einstellungen erfolgreich gespeichert.' });
});

// API: Benutzer auflisten (nur Admin)
router.get('/api/users', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    const db = await getDatabase();
    const users = await db.all('SELECT * FROM users');
    res.json(users);
});

// API: Benutzerrolle ändern (nur Admin)
router.put('/api/users/:id/role', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    const { role } = req.body;
    if (!['user', 'schulleitung', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Ungültige Rolle' });
    }

    const db = await getDatabase();
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ message: 'Rolle erfolgreich aktualisiert.' });
});

// API: Alle Schulleitungs-Mitglieder und Admins abrufen (für Dropdown)
router.get('/api/schulleitung-users', authMiddleware, async (req, res) => {
    const db = await getDatabase();
    const slUsers = await db.all(
        "SELECT id, display_name FROM users WHERE role = 'schulleitung' OR role = 'admin'"
    );
    res.json(slUsers);
});

// API: Unterrichtsbesuche abrufen
router.get('/api/unterrichtsbesuche', authMiddleware, async (req, res) => {
    const db = await getDatabase();
    let query = '';
    let params = [];

    if (req.user.role === 'schulleitung' || req.user.role === 'admin') {
        // Schulleitung und Admin sehen alle Unterrichtsbesuche
        // Join mit users, um den Namen der Lehrkraft anzuzeigen
        query = `
            SELECT ub.*, u.display_name as user_name, u.email as user_email, sl.display_name as assigned_sl_name
            FROM unterrichtsbesuche ub
            JOIN users u ON ub.user_id = u.id
            LEFT JOIN users sl ON ub.assigned_schulleitung_id = sl.id
            ORDER BY ub.date_time ASC
        `;
    } else {
        // Normale Benutzer sehen nur ihre eigenen
        query = `
            SELECT ub.*, sl.display_name as assigned_sl_name
            FROM unterrichtsbesuche ub
            LEFT JOIN users sl ON ub.assigned_schulleitung_id = sl.id
            WHERE ub.user_id = ?
            ORDER BY ub.date_time ASC
        `;
        params = [req.user.id];
    }

    const ubs = await db.all(query, params);
    res.json(ubs);
});

// API: Unterrichtsbesuch anlegen
router.post('/api/unterrichtsbesuche', authMiddleware, async (req, res) => {
    const { date_time, room, subject, grade, type, instructor, module, status } = req.body;

    if (!date_time || !room || !subject || !grade || !type) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen.' });
    }

    // Datum in der Zukunft validieren
    const ubDate = new Date(date_time);
    const now = new Date();
    // 5 Minuten Toleranzpuffer für Client/Server-Zeitschwankungen
    if (ubDate < new Date(now.getTime() - 5 * 60 * 1000)) {
        return res.status(400).json({ error: 'Das Datum des Unterrichtsbesuchs muss in der Zukunft liegen.' });
    }

    const db = await getDatabase();
    const finalStatus = status === 'submitted' ? 'submitted' : 'draft';

    const result = await db.run(`
        INSERT INTO unterrichtsbesuche (date_time, room, subject, grade, type, instructor, module, user_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [date_time, room, subject, grade, type, instructor || '', module || '', req.user.id, finalStatus]);

    const newUb = await db.get('SELECT * FROM unterrichtsbesuche WHERE id = ?', [result.lastID]);

    // Wenn direkt eingereicht wird, Mail senden
    if (finalStatus === 'submitted') {
        sendUBSubmittedMail(req.user.email, req.user.display_name, newUb);
    }

    res.status(201).json(newUb);
});

// API: Unterrichtsbesuch aktualisieren (Eintragen, Ändern oder Zuordnung)
router.put('/api/unterrichtsbesuche/:id', authMiddleware, async (req, res) => {
    const db = await getDatabase();
    const ub = await db.get('SELECT * FROM unterrichtsbesuche WHERE id = ?', [req.params.id]);

    if (!ub) {
        return res.status(404).json({ error: 'Unterrichtsbesuch nicht gefunden' });
    }

    // Fall 1: Schulleitung/Admin ordnet zu
    if (req.body.hasOwnProperty('assigned_schulleitung_id')) {
        if (req.user.role !== 'schulleitung' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Nur Schulleitung darf Begleitungen zuweisen.' });
        }

        const { assigned_schulleitung_id } = req.body;
        
        // Zuweisung in DB eintragen
        await db.run(
            'UPDATE unterrichtsbesuche SET assigned_schulleitung_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [assigned_schulleitung_id || null, req.params.id]
        );

        const updatedUb = await db.get('SELECT * FROM unterrichtsbesuche WHERE id = ?', [req.params.id]);

        // E-Mail Workflow auslösen
        if (assigned_schulleitung_id) {
            const teacher = await db.get('SELECT display_name, email FROM users WHERE id = ?', [ub.user_id]);
            const slUser = await db.get('SELECT display_name, email FROM users WHERE id = ?', [assigned_schulleitung_id]);

            if (teacher && slUser) {
                sendUBAssignedMails(teacher.email, teacher.display_name, slUser.email, slUser.display_name, updatedUb);
            }
        }

        return res.json(updatedUb);
    }

    // Fall 2: Lehrkraft editiert eigenen Unterrichtsbesuch
    if (ub.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Keine Berechtigung zur Bearbeitung dieses Eintrags' });
    }

    // Archivierte oder vergangene Termine dürfen nicht mehr bearbeitet werden (schreibgeschützt)
    const isPast = new Date(ub.date_time) < new Date();
    if (ub.status === 'archived' || isPast) {
        return res.status(400).json({ error: 'Vergangene oder archivierte Unterrichtsbesuche können nicht geändert werden.' });
    }

    const { date_time, room, subject, grade, type, instructor, module, status } = req.body;

    // Datum in der Zukunft validieren, falls geändert
    if (date_time) {
        const ubDate = new Date(date_time);
        const now = new Date();
        if (ubDate < new Date(now.getTime() - 5 * 60 * 1000)) {
            return res.status(400).json({ error: 'Das Datum des Unterrichtsbesuchs muss in der Zukunft liegen.' });
        }
    }

    const finalStatus = status === 'submitted' ? 'submitted' : ub.status;

    await db.run(`
        UPDATE unterrichtsbesuche
        SET date_time = ?, room = ?, subject = ?, grade = ?, type = ?, instructor = ?, module = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [
        date_time || ub.date_time,
        room || ub.room,
        subject || ub.subject,
        grade || ub.grade,
        type || ub.type,
        instructor || ub.instructor,
        module || ub.module,
        finalStatus,
        req.params.id
    ]);

    const updatedUb = await db.get('SELECT * FROM unterrichtsbesuche WHERE id = ?', [req.params.id]);

    // Wenn von draft zu submitted gewechselt wurde, E-Mail senden
    if (ub.status === 'draft' && finalStatus === 'submitted') {
        sendUBSubmittedMail(req.user.email, req.user.display_name, updatedUb);
    }

    res.json(updatedUb);
});

// API: Entwurf PDF-Upload
router.post('/api/unterrichtsbesuche/:id/upload', authMiddleware, upload.single('entwurf'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Keine PDF-Datei hochgeladen.' });
    }

    const db = await getDatabase();
    const ub = await db.get('SELECT * FROM unterrichtsbesuche WHERE id = ?', [req.params.id]);

    if (!ub) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Unterrichtsbesuch nicht gefunden.' });
    }

    if (ub.user_id !== req.user.id) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Keine Berechtigung für diesen Upload.' });
    }

    if (ub.file_path) {
        const oldFilePath = path.join(__dirname, ub.file_path);
        if (fs.existsSync(oldFilePath)) {
            try {
                fs.unlinkSync(oldFilePath);
            } catch (err) {
                console.error('Fehler beim Löschen des alten Entwurfs:', err);
            }
        }
    }

    const relativePath = 'uploads/' + req.file.filename;
    await db.run('UPDATE unterrichtsbesuche SET file_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [relativePath, req.params.id]);

    res.json({ file_path: relativePath, message: 'PDF-Entwurf erfolgreich hochgeladen.' });
});

// Router in Express einbinden unter dem BASE_PATH
app.use(BASE_PATH, router);

// Statische Dateien und Uploads unter dem BASE_PATH ausliefern
app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));
app.use(BASE_PATH + '/uploads', express.static(uploadDir));

// Fallback: Weiterleitung von / auf /unterrichtsbesuch
app.get('/', (req, res) => {
    res.redirect(BASE_PATH + '/');
});

// Fallback für /unterrichtsbesuch (ohne abschließenden Slash)
app.get(BASE_PATH, (req, res) => {
    res.redirect(BASE_PATH + '/');
});

// Start des Servers
app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}${BASE_PATH}`);
});
