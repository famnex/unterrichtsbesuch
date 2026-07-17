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
function generateICS(title, description, location, dateStr, organizer) {
    return new Promise((resolve, reject) => {
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
            busyStatus: 'BUSY',
            method: 'REQUEST' // Macht die ICS zur interaktiven Kalendereinladung (für Outlook/Gmail)
        };

        // WICHTIG: Für Outlook/Exchange ist bei einer REQUEST-Methode ein gültiger Organizer Pflicht!
        if (organizer && organizer.name && organizer.email && organizer.email.trim()) {
            event.organizer = {
                name: organizer.name,
                email: organizer.email.trim()
            };
        }

        ics.createEvent(event, (error, value) => {
            if (error) {
                return reject(error);
            }
            resolve(value);
        });
    });
}

/**
 * Hilfsfunktion zur Generierung eines einheitlichen HTML-E-Mail-Templates.
 */
function getHtmlTemplate(title, recipientName, contentHtml, isWarning = false) {
    const headerBg = isWarning ? '#e53e3e' : '#5850ec'; // Rot für Absagen, Blau für Standard
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f5f7; color: #2d3748; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); overflow: hidden; }
            .header { background-color: ${headerBg}; padding: 24px; text-align: center; color: #ffffff; }
            .header h1 { margin: 0; font-size: 22px; font-weight: 600; }
            .content { padding: 32px; line-height: 1.6; }
            .content p { margin: 0 0 16px 0; }
            .details-box { background-color: #f7fafc; border-left: 4px solid ${headerBg}; border-radius: 4px; padding: 20px; margin: 24px 0; }
            .details-row { display: flex; margin-bottom: 8px; font-size: 14px; }
            .details-row:last-child { margin-bottom: 0; }
            .details-label { width: 120px; font-weight: 600; color: #718096; }
            .details-value { flex: 1; color: #2d3748; }
            .footer { background-color: #edf2f7; padding: 16px; text-align: center; font-size: 12px; color: #718096; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${title}</h1>
            </div>
            <div class="content">
                <p>Hallo <strong>${recipientName}</strong>,</p>
                ${contentHtml}
            </div>
            <div class="footer">
                Dies ist eine automatisch generierte E-Mail des Unterrichtsbesuchs-Portals.
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Sendet eine E-Mail an den Benutzer, dass der UB erfolgreich eingereicht wurde.
 */
async function sendUBSubmittedMail(userEmail, userName, ubDetails) {
    if (!userEmail || !userEmail.trim()) {
        console.warn(`[WARNUNG] E-Mail zum eingereichten UB konnte nicht gesendet werden: Empfänger-E-Mail fehlt für Benutzer ${userName}`);
        return;
    }

    const transportInfo = await getTransporter();
    const subject = `Unterrichtsbesuch eingereicht: ${ubDetails.subject} (${ubDetails.grade})`;
    
    const dateFormatted = new Date(ubDetails.date_time).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const text = `Hallo ${userName},

Dein Unterrichtsbesuch am ${dateFormatted} im Fach ${ubDetails.subject} (Klasse ${ubDetails.grade}) wurde erfolgreich im System eingereicht.

Details zum Termin:
- Raum: ${ubDetails.room}
- Art: ${ubDetails.type}
- Fachleiter: ${ubDetails.instructor || 'Nicht angegeben'}
- Modul: ${ubDetails.module || 'Nicht angegeben'}

Sobald ein Mitglied der Schulleitung den Termin übernimmt, wirst du benachrichtigt.

Freundliche Grüße,
Dein Unterrichtsbesuchs-Portal`;

    const htmlContent = `
        <p>Dein Unterrichtsbesuch wurde erfolgreich im System eingereicht.</p>
        <div class="details-box">
            <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">${dateFormatted} Uhr</div></div>
            <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">${ubDetails.subject}</div></div>
            <div class="details-row"><div class="details-label">Klasse:</div><div class="details-value">${ubDetails.grade}</div></div>
            <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">${ubDetails.room}</div></div>
            <div class="details-row"><div class="details-label">Art:</div><div class="details-value">${ubDetails.type}</div></div>
            <div class="details-row"><div class="details-label">Fachleiter:</div><div class="details-value">${ubDetails.instructor || 'Nicht angegeben'}</div></div>
            <div class="details-row"><div class="details-label">Modul:</div><div class="details-value">${ubDetails.module || 'Nicht angegeben'}</div></div>
        </div>
        <p>Sobald ein Mitglied der Schulleitung den Termin übernimmt, wirst du benachrichtigt.</p>
        <p>Freundliche Grüße,<br>Dein Unterrichtsbesuchs-Portal</p>
    `;

    const html = getHtmlTemplate('Unterrichtsbesuch eingereicht', userName, htmlContent);

    if (!transportInfo) {
        console.log(`[SIMULATION MAIL] An: ${userEmail}\nBetreff: ${subject}\nHTML-Länge: ${html.length}\n---`);
        return;
    }

    try {
        await transportInfo.transporter.sendMail({
            from: transportInfo.from,
            to: userEmail,
            subject: subject,
            text: text,
            html: html
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
    
    const dateFormatted = new Date(ubDetails.date_time).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    // 1. ICS-Datei als interaktive Kalendereinladung erstellen (Method: REQUEST)
    let icsContent = null;
    try {
        const title = `${ubDetails.type}: ${ubDetails.subject} - ${userName}`;
        const description = `${ubDetails.type} von ${userName} im Fach ${ubDetails.subject} (Klasse ${ubDetails.grade}).\nFachleiter: ${ubDetails.instructor || 'n.a.'}\nModul: ${ubDetails.module || 'n.a.'}`;
        const location = `Raum ${ubDetails.room}`;
        
        // WICHTIG: Lehrkraft als Organizer übergeben, damit Exchange/Outlook das iCal-Request-Format akzeptiert!
        const organizer = (userEmail && userEmail.trim()) ? { name: userName, email: userEmail } : null;
        icsContent = await generateICS(title, description, location, ubDetails.date_time, organizer);
    } catch (err) {
        console.error('Fehler beim Generieren der ICS-Datei:', err);
    }

    // 2. Mail an Schulleitungsmitglied (mit interaktivem Kalender-Event & klassischem ICS-Anhang)
    const slSubject = `Begleitung Unterrichtsbesuch: ${ubDetails.subject} (${ubDetails.grade}) - ${userName}`;
    const slText = `Hallo ${slName},

du wurdest als Begleitung for den folgenden Unterrichtsbesuch eingetragen bzw. hast diesen übernommen:

Lehrkraft: ${userName}
Datum/Uhrzeit: ${dateFormatted}
Raum: ${ubDetails.room}
Fach: ${ubDetails.subject}
Klasse: ${ubDetails.grade}
Art: ${ubDetails.type}
Fachleiter: ${ubDetails.instructor || 'Nicht angegeben'}
Modul: ${ubDetails.module || 'Nicht angegeben'}

Im Anhang findest du eine Kalenderdatei (.ics), mit der du den Termin in deinen persönlichen Kalender eintragen kannst.

Freundliche Grüße,
Dein Unterrichtsbesuchs-Portal`;

    const slHtmlContent = `
        <p>du wurdest als Begleitung für den folgenden Termin eingetragen bzw. hast diesen übernommen:</p>
        <div class="details-box">
            <div class="details-row"><div class="details-label">Lehrkraft:</div><div class="details-value">${userName}</div></div>
            <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">${dateFormatted} Uhr</div></div>
            <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">${ubDetails.subject}</div></div>
            <div class="details-row"><div class="details-label">Klasse:</div><div class="details-value">${ubDetails.grade}</div></div>
            <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">${ubDetails.room}</div></div>
            <div class="details-row"><div class="details-label">Art:</div><div class="details-value">${ubDetails.type}</div></div>
            <div class="details-row"><div class="details-label">Fachleiter:</div><div class="details-value">${ubDetails.instructor || 'Nicht angegeben'}</div></div>
            <div class="details-row"><div class="details-label">Modul:</div><div class="details-value">${ubDetails.module || 'Nicht angegeben'}</div></div>
        </div>
        <p>Outlook, Gmail und andere Clients sollten Ihnen diesen Termin direkt oben als interaktive Kalendereinladung (Zusagen/Ablehnen) anzeigen. Alternativ können Sie die beigefügte .ics-Datei öffnen.</p>
        <p>Freundliche Grüße,<br>Dein Unterrichtsbesuchs-Portal</p>
    `;

    const slHtml = getHtmlTemplate('Terminbegleitung zugewiesen', slName, slHtmlContent);

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

dein Unterrichtsbesuch am ${dateFormatted} im Fach ${ubDetails.subject} (Klasse ${ubDetails.grade}) wird begleitet von:

Name: ${slName}
E-Mail: ${slEmail}

Bitte stelle sicher, dass du deinen Unterrichtsentwurf (PDF) rechtzeitig im Portal hochlädst.

Freundliche Grüße,
Dein Unterrichtsbesuchs-Portal`;

    const userHtmlContent = `
        <p>dein Unterrichtsbesuch wird begleitet von:</p>
        <div class="details-box">
            <div class="details-row"><div class="details-label">Begleitung:</div><div class="details-value"><strong>${slName}</strong> (${slEmail})</div></div>
            <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">${dateFormatted} Uhr</div></div>
            <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">${ubDetails.subject}</div></div>
            <div class="details-row"><div class="details-label">Klasse:</div><div class="details-value">${ubDetails.grade}</div></div>
            <div class="details-row"><div class="details-label">Raum:</div><div class="details-value">${ubDetails.room}</div></div>
        </div>
        <p>Bitte stelle sicher, dass du deinen Unterrichtsentwurf (PDF) rechtzeitig im Portal hochlädst.</p>
        <p>Freundliche Grüße,<br>Dein Unterrichtsbesuchs-Portal</p>
    `;

    const userHtml = getHtmlTemplate('Begleitung für Unterrichtsbesuch', userName, userHtmlContent);

    if (!transportInfo) {
        console.log(`[SIMULATION MAIL] An SL: ${slEmail}\nBetreff: ${slSubject}\nMit interaktivem Kalender-Event (ics): ${!!icsContent}\n---`);
        console.log(`[SIMULATION MAIL] An Benutzer: ${userEmail}\nBetreff: ${userSubject}\nHTML-Länge: ${userHtml.length}\n---`);
        return;
    }

    // SICHERHEITSPRÜFUNGEN VOR VERSAND
    if (slEmail && slEmail.trim()) {
        try {
            const slMailConfig = {
                from: transportInfo.from,
                to: slEmail,
                subject: slSubject,
                text: slText,
                html: slHtml,
                attachments: slAttachments
            };

            if (icsContent) {
                slMailConfig.icalEvent = {
                    filename: 'unterrichtsbesuch.ics',
                    method: 'request',
                    content: icsContent
                };
            }

            await transportInfo.transporter.sendMail(slMailConfig);
            console.log(`E-Mail "Begleitung zugewiesen" erfolgreich an Schulleitung (${slEmail}) gesendet.`);
        } catch (err) {
            console.error(`Fehler beim Senden an Schulleitung (${slEmail}):`, err);
        }
    } else {
        console.warn(`[WARNUNG] Keine Benachrichtigung an Schulleitung gesendet: Keine E-Mail-Adresse für ${slName} vorhanden.`);
    }

    if (userEmail && userEmail.trim()) {
        try {
            await transportInfo.transporter.sendMail({
                from: transportInfo.from,
                to: userEmail,
                subject: userSubject,
                text: userText,
                html: userHtml
            });
            console.log(`E-Mail "Begleitungs-Info" erfolgreich an Benutzer (${userEmail}) gesendet.`);
        } catch (err) {
            console.error(`Fehler beim Senden an Benutzer (${userEmail}):`, err);
        }
    } else {
        console.warn(`[WARNUNG] Keine Benachrichtigung an Benutzer gesendet: Keine E-Mail-Adresse für ${userName} vorhanden.`);
    }
}

/**
 * Sendet E-Mails bei Absage eines Unterrichtsbesuchs.
 */
async function sendUBCancelledMails(userEmail, userName, slEmail, slName, ubDetails) {
    const transportInfo = await getTransporter();
    
    const dateFormatted = new Date(ubDetails.date_time).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const subjectText = `ABGESAGT: ${ubDetails.type} am ${dateFormatted} - ${userName}`;

    // 1. Mail an den Benutzer (Bestätigung der Absage)
    const userText = `Hallo ${userName},

dein Unterrichtsbesuch am ${dateFormatted} im Fach ${ubDetails.subject} (Klasse ${ubDetails.grade}) wurde erfolgreich abgesagt.

Details zum abgesagten Termin:
- Raum: ${ubDetails.room}
- Art: ${ubDetails.type}

Freundliche Grüße,
Dein Unterrichtsbesuchs-Portal`;

    const userHtmlContent = `
        <p>dein Unterrichtsbesuch wurde erfolgreich im System abgesagt.</p>
        <div class="details-box" style="border-left-color: #e53e3e;">
            <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">${dateFormatted} Uhr</div></div>
            <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">${ubDetails.subject}</div></div>
            <div class="details-row"><div class="details-label">Klasse:</div><div class="details-value">${ubDetails.grade}</div></div>
            <div class="details-row"><div class="details-label">Art:</div><div class="details-value">${ubDetails.type}</div></div>
        </div>
        <p>Freundliche Grüße,<br>Dein Unterrichtsbesuchs-Portal</p>
    `;

    const userHtml = getHtmlTemplate('Unterrichtsbesuch abgesagt', userName, userHtmlContent, true);

    // 2. Mail an Schulleitung (falls zugeordnet)
    let slText = '';
    let slHtml = '';
    let cancelIcs = '';
    
    if (slEmail && slName) {
        slText = `Hallo ${slName},

der folgende Unterrichtsbesuch, den du begleiten solltest, wurde von der Lehrkraft abgesagt:

Lehrkraft: ${userName}
Datum/Uhrzeit: ${dateFormatted}
Fach: ${ubDetails.subject}
Klasse: ${ubDetails.grade}
Art: ${ubDetails.type}

Der Termin wurde in deinem Kalender-Workflow storniert.

Freundliche Grüße,
Dein Unterrichtsbesuchs-Portal`;

        const slHtmlContent = `
            <p>der folgende Termin, für den du als Begleitung eingetragen warst, wurde von der Lehrkraft abgesagt:</p>
            <div class="details-box" style="border-left-color: #e53e3e;">
                <div class="details-row"><div class="details-label">Lehrkraft:</div><div class="details-value">${userName}</div></div>
                <div class="details-row"><div class="details-label">Termin:</div><div class="details-value">${dateFormatted} Uhr</div></div>
                <div class="details-row"><div class="details-label">Fach:</div><div class="details-value">${ubDetails.subject}</div></div>
                <div class="details-row"><div class="details-label">Klasse:</div><div class="details-value">${ubDetails.grade}</div></div>
                <div class="details-row"><div class="details-label">Art:</div><div class="details-value">${ubDetails.type}</div></div>
            </div>
            <p>Der Termin ist für Sie storniert.</p>
            <p>Freundliche Grüße,<br>Dein Unterrichtsbesuchs-Portal</p>
        `;

        slHtml = getHtmlTemplate('HINWEIS: Begleitung abgesagt', slName, slHtmlContent, true);

        try {
            const title = `ABGESAGT: ${ubDetails.type}: ${ubDetails.subject} - ${userName}`;
            const description = `Dieser Termin wurde abgesagt.`;
            const location = `Raum ${ubDetails.room}`;
            
            // WICHTIG: Lehrkraft als Organizer übergeben
            const organizer = (userEmail && userEmail.trim()) ? { name: userName, email: userEmail } : null;
            const icsCancelContent = await generateICS(title, description, location, ubDetails.date_time, organizer);
            cancelIcs = icsCancelContent.replace('METHOD:REQUEST', 'METHOD:CANCEL').replace('STATUS:CONFIRMED', 'STATUS:CANCELLED');
        } catch (icsErr) {
            console.error('Fehler bei Stornierungs-ICS-Generierung:', icsErr);
        }
    }

    if (!transportInfo) {
        console.log(`[SIMULATION MAIL] Absage an Benutzer: ${userEmail}\nBetreff: ${subjectText}\n---`);
        if (slEmail) {
            console.log(`[SIMULATION MAIL] Absage an Schulleitung: ${slEmail}\nBetreff: ${subjectText}\n---`);
        }
        return;
    }

    // SICHERHEITSPRÜFUNGEN VOR VERSAND
    if (userEmail && userEmail.trim()) {
        try {
            await transportInfo.transporter.sendMail({
                from: transportInfo.from,
                to: userEmail,
                subject: `Bestätigung: Unterrichtsbesuch abgesagt am ${dateFormatted}`,
                text: userText,
                html: userHtml
            });
            console.log(`Absage-E-Mail erfolgreich an Benutzer (${userEmail}) gesendet.`);
        } catch (err) {
            console.error(`Fehler beim Senden der Absage an Benutzer (${userEmail}):`, err);
        }
    } else {
        console.warn(`[WARNUNG] Keine Absage-Bestätigung an Benutzer gesendet: Keine E-Mail-Adresse für ${userName} vorhanden.`);
    }

    if (slEmail && slEmail.trim() && slName) {
        try {
            const mailConfig = {
                from: transportInfo.from,
                to: slEmail,
                subject: `ABGESAGT: Begleitung Unterrichtsbesuch ${userName}`,
                text: slText,
                html: slHtml
            };
            
            if (cancelIcs) {
                mailConfig.icalEvent = {
                    filename: 'stornierung.ics',
                    method: 'cancel',
                    content: cancelIcs
                };
            }

            await transportInfo.transporter.sendMail(mailConfig);
            console.log(`Absage-E-Mail erfolgreich an Schulleitung (${slEmail}) gesendet.`);
        } catch (err) {
            console.error(`Fehler beim Senden der Absage an Schulleitung (${slEmail}):`, err);
        }
    }
}

module.exports = {
    sendUBSubmittedMail,
    sendUBAssignedMails,
    sendUBCancelledMails
};
