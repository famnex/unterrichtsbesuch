const nodemailer = require('nodemailer');
const ics = require('ics');
const { getDatabase } = require('./db');

/**
 * Erstellt einen Transporter basierend auf den aktuellen Einstellungen in der Datenbank.
 */
async function getTransporter() {
    const db = await getDatabase();
    const settings = await db.get('SELECT * FROM settings WHERE id = 1');

    if (!settings || !settings.smtp_host || !settings.smtp_port) {
        console.warn('SMTP ist nicht konfiguriert oder unvollständig. E-Mail-Versand wird simuliert.');
        return null;
    }

    const config = {
        host: settings.smtp_host,
        port: settings.smtp_port,
        secure: settings.smtp_port === 465, // True für 465, False für andere
        auth: {
            user: settings.smtp_user,
            pass: settings.smtp_pass
        }
    };

    return {
        transporter: nodemailer.createTransport(config),
        from: settings.smtp_from || settings.smtp_user
    };
}

/**
 * Generiert eine ICS-Datei für ein Event.
 */
function generateICS(title, description, location, dateStr) {
    return new Promise((resolve, reject) => {
        // Erwartetes Format für dateStr: "YYYY-MM-DDTHH:MM" oder ähnlich
        const dateObj = new Date(dateStr);
        if (isNaN(dateObj.getTime())) {
            return reject(new Error('Ungültiges Datumsformat für ICS'));
        }

        const start = [
            dateObj.getFullYear(),
            dateObj.getMonth() + 1, // 1-12
            dateObj.getDate(),
            dateObj.getHours(),
            dateObj.getMinutes()
        ];

        const event = {
            start: start,
            duration: { hours: 1, minutes: 0 }, // Standardmäßig 1 Stunde
            title: title,
            description: description,
            location: location,
            status: 'CONFIRMED',
            busyStatus: 'BUSY'
        };

        ics.createEvent(event, (error, value) => {
            if (error) {
                return reject(error);
            }
            resolve(value);
        });
    });
}

/**
 * Sendet eine E-Mail an den Benutzer, dass der UB erfolgreich eingereicht wurde.
 */
async function sendUBSubmittedMail(userEmail, userName, ubDetails) {
    const transportInfo = await getTransporter();
    const subject = `Unterrichtsbesuch eingereicht: ${ubDetails.subject} (${ubDetails.grade})`;
    
    const text = `Hallo ${userName},

Dein Unterrichtsbesuch am ${new Date(ubDetails.date_time).toLocaleString('de-DE')} im Fach ${ubDetails.subject} (Klasse ${ubDetails.grade}) wurde erfolgreich im System eingereicht.

Details zum Termin:
- Raum: ${ubDetails.room}
- Art: ${ubDetails.type}
- Fachleiter: ${ubDetails.instructor || 'Nicht angegeben'}
- Modul: ${ubDetails.module || 'Nicht angegeben'}

Sobald ein Mitglied der Schulleitung den Termin übernimmt, wirst du benachrichtigt.

Freundliche Grüße,
Dein Unterrichtsbesuchs-Portal`;

    if (!transportInfo) {
        console.log(`[SIMULATION MAIL] An: ${userEmail}\nBetreff: ${subject}\nInhalt:\n${text}\n---`);
        return;
    }

    try {
        await transportInfo.transporter.sendMail({
            from: transportInfo.from,
            to: userEmail,
            subject: subject,
            text: text
        });
        console.log(`E-Mail "UB eingereicht" erfolgreich an ${userEmail} gesendet.`);
    } catch (err) {
        console.error('Fehler beim Senden der "UB eingereicht" E-Mail:', err);
    }
}

/**
 * Sendet E-Mails bei Übernahme/Zuweisung durch ein Schulleitungsmitglied.
 */
async function sendUBAssignedMails(userEmail, userName, slEmail, slName, ubDetails) {
    const transportInfo = await getTransporter();
    
    // 1. ICS-Datei erstellen
    let icsContent = null;
    try {
        const title = `Unterrichtsbesuch: ${ubDetails.subject} - ${userName}`;
        const description = `Unterrichtsbesuch von ${userName} im Fach ${ubDetails.subject} (Klasse ${ubDetails.grade}).\nFachleiter: ${ubDetails.instructor || 'n.a.'}\nModul: ${ubDetails.module || 'n.a.'}`;
        const location = `Raum ${ubDetails.room}`;
        icsContent = await generateICS(title, description, location, ubDetails.date_time);
    } catch (err) {
        console.error('Fehler beim Generieren der ICS-Datei:', err);
    }

    // 2. Mail an Schulleitungsmitglied
    const slSubject = `Begleitung Unterrichtsbesuch: ${ubDetails.subject} (${ubDetails.grade}) - ${userName}`;
    const slText = `Hallo ${slName},

du wurdest als Begleitung für den folgenden Unterrichtsbesuch eingetragen bzw. hast diesen übernommen:

Lehrkraft: ${userName}
Datum/Uhrzeit: ${new Date(ubDetails.date_time).toLocaleString('de-DE')}
Raum: ${ubDetails.room}
Fach: ${ubDetails.subject}
Klasse: ${ubDetails.grade}
Art: ${ubDetails.type}
Fachleiter: ${ubDetails.instructor || 'Nicht angegeben'}
Modul: ${ubDetails.module || 'Nicht angegeben'}

Im Anhang findest du eine Kalenderdatei (.ics), mit der du den Termin in deinen persönlichen Kalender (Outlook, Apple Calendar etc.) eintragen kannst.

Freundliche Grüße,
Dein Unterrichtsbesuchs-Portal`;

    const slAttachments = [];
    if (icsContent) {
        slAttachments.push({
            filename: 'unterrichtsbesuch.ics',
            content: icsContent,
            contentType: 'text/calendar'
        });
    }

    // 3. Mail an Benutzer
    const userSubject = `Begleitung für deinen Unterrichtsbesuch am ${new Date(ubDetails.date_time).toLocaleDateString('de-DE')}`;
    const userText = `Hallo ${userName},

dein Unterrichtsbesuch am ${new Date(ubDetails.date_time).toLocaleString('de-DE')} im Fach ${ubDetails.subject} (Klasse ${ubDetails.grade}) wird begleitet von:

Name: ${slName}
E-Mail: ${slEmail}

Bitte stelle sicher, dass du deinen Unterrichtsentwurf (PDF) rechtzeitig im Portal hochlädst.

Freundliche Grüße,
Dein Unterrichtsbesuchs-Portal`;

    if (!transportInfo) {
        console.log(`[SIMULATION MAIL] An SL: ${slEmail}\nBetreff: ${slSubject}\nInhalt:\n${slText}\nMit ICS-Anhang: ${!!icsContent}\n---`);
        console.log(`[SIMULATION MAIL] An Benutzer: ${userEmail}\nBetreff: ${userSubject}\nInhalt:\n${userText}\n---`);
        return;
    }

    try {
        // Sende Mail an Schulleitung (mit ICS)
        await transportInfo.transporter.sendMail({
            from: transportInfo.from,
            to: slEmail,
            subject: slSubject,
            text: slText,
            attachments: slAttachments
        });
        console.log(`E-Mail "Begleitung zugewiesen" erfolgreich an Schulleitung (${slEmail}) gesendet.`);

        // Sende Mail an Benutzer
        await transportInfo.transporter.sendMail({
            from: transportInfo.from,
            to: userEmail,
            subject: userSubject,
            text: userText
        });
        console.log(`E-Mail "Begleitungs-Info" erfolgreich an Benutzer (${userEmail}) gesendet.`);
    } catch (err) {
        console.error('Fehler beim Senden der Zuweisungs-E-Mails:', err);
    }
}

module.exports = {
    sendUBSubmittedMail,
    sendUBAssignedMails
};
