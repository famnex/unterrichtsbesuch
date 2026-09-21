const nodemailer = require('nodemailer');
const ics = require('ics');
const { getDatabase, DEFAULT_TEMPLATES } = require('./db');

/**
 * Erstellt einen Transporter basierend auf den aktuellen Einstellungen in der Datenbank.
 */
async function getTransporter() {
    const db = await getDatabase();
    const settings = await db.get('SELECT * FROM settings WHERE id = 1');

    if (!settings || !settings.smtp_host || !settings.smtp_port) {
        console.warn('[MAIL-DEBUG] SMTP ist nicht in der Datenbank konfiguriert. Sendeversuch wird simuliert.');
        return null;
    }

    console.log(`[MAIL-DEBUG] SMTP-Konfiguration: Host=${settings.smtp_host}, Port=${settings.smtp_port}, User=${settings.smtp_user}, Sender=${settings.smtp_from}`);

    const config = {
        host: settings.smtp_host,
        port: parseInt(settings.smtp_port, 10),
        secure: parseInt(settings.smtp_port, 10) === 465, // True für 465, False für andere (z.B. 587 STARTTLS)
        auth: {
            user: settings.smtp_user,
            pass: settings.smtp_pass
        }
    };

    try {
        const transporter = nodemailer.createTransport(config);
        return {
            transporter: transporter,
            from: settings.smtp_from || settings.smtp_user
        };
    } catch (err) {
        console.error('[MAIL-ERROR] Fehler beim Erstellen des Nodemailer-Transporters:', err);
        return null;
    }
}

/**
 * Hilfsfunktion: Lädt eine E-Mail-Vorlage und ersetzt alle Platzhalter.
 */
async function renderTemplate(templateId, variables = {}) {
    const db = await getDatabase();
    let template = await db.get('SELECT * FROM mail_templates WHERE id = ?', [templateId]);

    if (!template) {
        template = DEFAULT_TEMPLATES.find(t => t.id === templateId) || {
            subject: 'Benachrichtigung Unterrichtsbesuch',
            body_html: '<p>Benachrichtigung zum Unterrichtsbesuch.</p>'
        };
    }

    let subject = template.subject || '';
    let bodyHtml = template.body_html || '';

    // Platzhalter ersetzen
    for (const [key, value] of Object.entries(variables)) {
        const valStr = (value !== null && value !== undefined) ? String(value) : '';
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        subject = subject.replace(regex, valStr);
        bodyHtml = bodyHtml.replace(regex, valStr);
    }

    // HTML-Tags für reinen Textfilter entfernen
    const plainText = bodyHtml
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<div class="details-row"><div class="details-label">([^<]+)<\/div><div class="details-value">([^<]+)<\/div><\/div>/gi, '$1 $2\n')
        .replace(/<br\s*[\/]?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]+>/gi, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .trim();

    const fullHtml = getHtmlWrapper(subject, bodyHtml, templateId.includes('cancel') || templateId.includes('reminder'));

    return {
        subject,
        bodyHtml,
        fullHtml,
        plainText
    };
}

/**
 * HTML-Container-Layout für alle E-Mails.
 */
function getHtmlWrapper(title, contentHtml, isWarning = false) {
    const headerBg = isWarning ? '#dc2626' : '#5850ec';
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f5f7; color: #2d3748; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); overflow: hidden; }
            .header { background-color: ${headerBg}; padding: 24px; text-align: center; color: #ffffff; }
            .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
            .content { padding: 32px; line-height: 1.6; }
            .content p { margin: 0 0 16px 0; }
            .details-box { background-color: #f8fafc; border-left: 4px solid ${headerBg}; border-radius: 4px; padding: 18px; margin: 20px 0; }
            .details-row { display: flex; margin-bottom: 8px; font-size: 14px; }
            .details-row:last-child { margin-bottom: 0; }
            .details-label { width: 130px; font-weight: 600; color: #64748b; }
            .details-value { flex: 1; color: #1e293b; }
            .footer { background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #64748b; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${title}</h1>
            </div>
            <div class="content">
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
 * Generiert eine ICS-Datei für ein Event.
 */
function generateICS(title, description, location, dateStr, organizer, attendee, uid) {
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
            uid: uid || `ub-${Date.now()}-${Math.random()}@schule.de`,
            start: start,
            duration: { hours: 1, minutes: 0 },
            title: title,
            description: description,
            location: location,
            status: 'CONFIRMED',
            busyStatus: 'BUSY',
            method: 'REQUEST'
        };

        if (organizer && organizer.name && organizer.email && organizer.email.trim()) {
            event.organizer = {
                name: organizer.name,
                email: organizer.email.trim()
            };
        }

        if (attendee && attendee.name && attendee.email && attendee.email.trim()) {
            event.attendees = [
                {
                    name: attendee.name,
                    email: attendee.email.trim(),
                    rsvp: true,
                    role: 'REQ-PARTICIPANT',
                    partstat: 'NEEDS-ACTION'
                }
            ];
        }

        ics.createEvent(event, (error, value) => {
            if (error) {
                return reject(error);
            }
            resolve(value);
        });
    });
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/**
 * Sendet eine Test-E-Mail mit den aktuellen SMTP-Einstellungen.
 */
async function sendTestMail(toEmail) {
    if (!toEmail || !toEmail.trim()) {
        throw new Error('Empfänger-E-Mail-Adresse fehlt.');
    }

    const transportInfo = await getTransporter();
    if (!transportInfo) {
        throw new Error('SMTP ist nicht konfiguriert. Bitte überprüfen Sie die SMTP-Einstellungen.');
    }

    const subject = 'Test-E-Mail: Unterrichtsbesuchs-Portal';
    const htmlContent = `
        <p>Hallo,</p>
        <p>dies ist eine <strong>erfolgreiche Test-E-Mail</strong> aus Ihrem Unterrichtsbesuchs-Portal.</p>
        <div class="details-box">
            <div class="details-row"><div class="details-label">Zeitpunkt:</div><div class="details-value">${new Date().toLocaleString('de-DE')}</div></div>
            <div class="details-row"><div class="details-label">Absender:</div><div class="details-value">${transportInfo.from}</div></div>
            <div class="details-row"><div class="details-label">Empfänger:</div><div class="details-value">${toEmail}</div></div>
        </div>
        <p>Ihr E-Mail-Versand ist optimal eingerichtet und funktionsfähig!</p>
    `;
    const fullHtml = getHtmlWrapper('Test-E-Mail erfolgreich', htmlContent);

    console.log(`[MAIL-TEST] Sende Test-E-Mail an ${toEmail}...`);
    await transportInfo.transporter.sendMail({
        from: transportInfo.from,
        to: toEmail,
        subject: subject,
        text: 'Test-E-Mail aus dem Unterrichtsbesuchs-Portal: Ihr E-Mail-Versand ist betriebsbereit.',
        html: fullHtml
    });
    console.log(`[MAIL-SUCCESS] Test-E-Mail erfolgreich an ${toEmail} gesendet.`);
    return true;
}

/**
 * a & b: Sendet E-Mails bei Einreichung eines UBs:
 * a. An alle Schulleitungsmitglieder
 * b. An die Lehrkraft (LiV) mit Hinweis auf Upload-Frist (1 Tag vorher)
 */
async function sendUBSubmittedMail(userEmail, userName, ubDetails) {
    console.log(`[MAIL-DEBUG] sendUBSubmittedMail: LiV="${userName}" <${userEmail}>, UB-ID=${ubDetails.id}`);
    const transportInfo = await getTransporter();
    const dateFormatted = formatDate(ubDetails.date_time);

    const baseVariables = {
        user_name: userName,
        user_email: userEmail,
        subject: ubDetails.subject,
        grade: ubDetails.grade,
        room: ubDetails.room,
        type: ubDetails.type,
        instructor: ubDetails.instructor || 'Nicht angegeben',
        module: ubDetails.module || 'Nicht angegeben',
        date_time: dateFormatted
    };

    // b. Bestätigung an die Lehrkraft (LiV)
    if (userEmail && userEmail.trim()) {
        try {
            const renderedLiv = await renderTemplate('ub_created_liv', {
                ...baseVariables,
                recipient_name: userName,
                recipient_email: userEmail
            });

            if (transportInfo) {
                await transportInfo.transporter.sendMail({
                    from: transportInfo.from,
                    to: userEmail,
                    subject: renderedLiv.subject,
                    text: renderedLiv.plainText,
                    html: renderedLiv.fullHtml
                });
                console.log(`[MAIL-SUCCESS] Einreichungsbestätigung (b) an LiV (${userEmail}) gesendet.`);
            } else {
                console.log(`[SIMULATION MAIL] An LiV: ${userEmail}\nBetreff: ${renderedLiv.subject}`);
            }
        } catch (err) {
            console.error('[MAIL-ERROR] Fehler beim Senden an LiV:', err);
        }
    }

    // a. Benachrichtigung an alle Schulleitungsmitglieder
    try {
        const db = await getDatabase();
        const slUsers = await db.all("SELECT display_name, email FROM users WHERE (role = 'schulleitung' OR role = 'admin') AND email IS NOT NULL AND email != ''");
        
        console.log(`[MAIL-DEBUG] Gefundene SL-Mitglieder für Benachrichtigung (a): ${slUsers.length}`);

        for (const sl of slUsers) {
            const renderedSl = await renderTemplate('ub_created_sl', {
                ...baseVariables,
                recipient_name: sl.display_name || 'Schulleitungsmitglied',
                recipient_email: sl.email
            });

            if (transportInfo) {
                await transportInfo.transporter.sendMail({
                    from: transportInfo.from,
                    to: sl.email,
                    subject: renderedSl.subject,
                    text: renderedSl.plainText,
                    html: renderedSl.fullHtml
                });
                console.log(`[MAIL-SUCCESS] Benachrichtigung über neuen UB (a) an SL (${sl.email}) gesendet.`);
            } else {
                console.log(`[SIMULATION MAIL] An SL: ${sl.email}\nBetreff: ${renderedSl.subject}`);
            }
        }
    } catch (err) {
        console.error('[MAIL-ERROR] Fehler beim Senden an SL-Mitglieder:', err);
    }
}

/**
 * c. Erinnerung an LiV, wenn am Vortag (9:00 Uhr) kein Entwurf hochgeladen wurde.
 */
async function sendDraftReminderMail(userEmail, userName, ubDetails) {
    if (!userEmail || !userEmail.trim()) return;
    const transportInfo = await getTransporter();
    const dateFormatted = formatDate(ubDetails.date_time);

    const rendered = await renderTemplate('reminder_draft_liv', {
        user_name: userName,
        user_email: userEmail,
        recipient_name: userName,
        recipient_email: userEmail,
        subject: ubDetails.subject,
        grade: ubDetails.grade,
        room: ubDetails.room,
        type: ubDetails.type,
        instructor: ubDetails.instructor || 'Nicht angegeben',
        module: ubDetails.module || 'Nicht angegeben',
        date_time: dateFormatted
    });

    if (transportInfo) {
        await transportInfo.transporter.sendMail({
            from: transportInfo.from,
            to: userEmail,
            subject: rendered.subject,
            text: rendered.plainText,
            html: rendered.fullHtml
        });
        console.log(`[MAIL-SUCCESS] Erinnerung fehlender Entwurf (c) an LiV (${userEmail}) gesendet.`);
    } else {
        console.log(`[SIMULATION MAIL] Erinnerung Entwurf an LiV (${userEmail})`);
    }
}

/**
 * d. Erinnerung an alle SL-Mitglieder, wenn der UB am Vortag (9:00 Uhr) noch nicht zugewiesen wurde.
 */
async function sendUnassignedSLReminderMail(userName, userEmail, ubDetails) {
    const transportInfo = await getTransporter();
    const db = await getDatabase();
    const slUsers = await db.all("SELECT display_name, email FROM users WHERE (role = 'schulleitung' OR role = 'admin') AND email IS NOT NULL AND email != ''");
    const dateFormatted = formatDate(ubDetails.date_time);

    console.log(`[MAIL-DEBUG] Sende Erinnerung nicht zugewiesener UB (d) an ${slUsers.length} SL-Mitglieder...`);

    for (const sl of slUsers) {
        const rendered = await renderTemplate('reminder_unassigned_sl', {
            user_name: userName,
            user_email: userEmail,
            recipient_name: sl.display_name || 'Schulleitungsmitglied',
            recipient_email: sl.email,
            subject: ubDetails.subject,
            grade: ubDetails.grade,
            room: ubDetails.room,
            type: ubDetails.type,
            instructor: ubDetails.instructor || 'Nicht angegeben',
            module: ubDetails.module || 'Nicht angegeben',
            date_time: dateFormatted
        });

        if (transportInfo) {
            await transportInfo.transporter.sendMail({
                from: transportInfo.from,
                to: sl.email,
                subject: rendered.subject,
                text: rendered.plainText,
                html: rendered.fullHtml
            });
            console.log(`[MAIL-SUCCESS] Erinnerung nicht zugewiesen (d) an SL (${sl.email}) gesendet.`);
        } else {
            console.log(`[SIMULATION MAIL] Nicht zugewiesen (d) an SL (${sl.email})`);
        }
    }
}

/**
 * e. Terminerinnerung an zugewiesenes SL-Mitglied am Vortag (10:00 Uhr).
 */
async function sendUpcomingSLReminderMail(slEmail, slName, userName, userEmail, ubDetails) {
    if (!slEmail || !slEmail.trim()) return;
    const transportInfo = await getTransporter();
    const dateFormatted = formatDate(ubDetails.date_time);

    const rendered = await renderTemplate('reminder_upcoming_sl', {
        user_name: userName,
        user_email: userEmail,
        recipient_name: slName,
        recipient_email: slEmail,
        subject: ubDetails.subject,
        grade: ubDetails.grade,
        room: ubDetails.room,
        type: ubDetails.type,
        instructor: ubDetails.instructor || 'Nicht angegeben',
        module: ubDetails.module || 'Nicht angegeben',
        date_time: dateFormatted
    });

    if (transportInfo) {
        await transportInfo.transporter.sendMail({
            from: transportInfo.from,
            to: slEmail,
            subject: rendered.subject,
            text: rendered.plainText,
            html: rendered.fullHtml
        });
        console.log(`[MAIL-SUCCESS] Terminerinnerung (e) an zugewiesenes SL-Mitglied (${slEmail}) gesendet.`);
    } else {
        console.log(`[SIMULATION MAIL] Terminerinnerung (e) an SL (${slEmail})`);
    }
}

/**
 * Sendet E-Mails bei Zuweisung eines Unterrichtsbesuchs.
 */
async function sendUBAssignedMails(userEmail, userName, slEmail, slName, ubDetails) {
    const transportInfo = await getTransporter();
    const dateFormatted = formatDate(ubDetails.date_time);
    const eventUid = `ub-event-${ubDetails.id}@${(transportInfo ? transportInfo.from.split('@')[1] : 'ubportal.local') || 'ubportal.local'}`;

    let icsContent = null;
    try {
        const title = `${ubDetails.type}: ${ubDetails.subject} - ${userName}`;
        const description = `${ubDetails.type} von ${userName} im Fach ${ubDetails.subject} (Klasse ${ubDetails.grade}).\nFachleiter: ${ubDetails.instructor || 'n.a.'}\nModul: ${ubDetails.module || 'n.a.'}`;
        const location = `Raum ${ubDetails.room}`;
        
        const organizer = { 
            name: userName, 
            email: transportInfo ? transportInfo.from : 'mail@schule.de'
        };
        const attendee = (slEmail && slEmail.trim()) ? { name: slName, email: slEmail } : null;
        icsContent = await generateICS(title, description, location, ubDetails.date_time, organizer, attendee, eventUid);
    } catch (err) {
        console.error('[MAIL-ERROR] Fehler beim Generieren der ICS-Datei:', err);
    }

    const variables = {
        user_name: userName,
        user_email: userEmail,
        sl_name: slName,
        sl_email: slEmail,
        subject: ubDetails.subject,
        grade: ubDetails.grade,
        room: ubDetails.room,
        type: ubDetails.type,
        instructor: ubDetails.instructor || 'Nicht angegeben',
        module: ubDetails.module || 'Nicht angegeben',
        date_time: dateFormatted
    };

    // Mail an Schulleitung (mit iCal REQUEST)
    if (slEmail && slEmail.trim()) {
        try {
            const renderedSl = await renderTemplate('ub_assigned_sl', {
                ...variables,
                recipient_name: slName,
                recipient_email: slEmail
            });

            if (transportInfo) {
                const slMailConfig = {
                    from: transportInfo.from,
                    to: slEmail,
                    subject: renderedSl.subject,
                    text: renderedSl.plainText,
                    html: renderedSl.fullHtml
                };

                if (icsContent) {
                    slMailConfig.icalEvent = {
                        method: 'REQUEST',
                        content: icsContent
                    };
                }

                await transportInfo.transporter.sendMail(slMailConfig);
                console.log(`[MAIL-SUCCESS] Zuweisungs-Mail an Schulleitung (${slEmail}) gesendet.`);
            } else {
                console.log(`[SIMULATION MAIL] Zuweisungs-Mail an SL: ${slEmail}`);
            }
        } catch (err) {
            console.error(`[MAIL-ERROR] Fehler beim Senden an Schulleitung (${slEmail}):`, err);
        }
    }

    // Mail an LiV
    if (userEmail && userEmail.trim()) {
        try {
            const renderedLiv = await renderTemplate('ub_assigned_liv', {
                ...variables,
                recipient_name: userName,
                recipient_email: userEmail
            });

            if (transportInfo) {
                await transportInfo.transporter.sendMail({
                    from: transportInfo.from,
                    to: userEmail,
                    subject: renderedLiv.subject,
                    text: renderedLiv.plainText,
                    html: renderedLiv.fullHtml
                });
                console.log(`[MAIL-SUCCESS] Begleitungs-Info an Lehrkraft (${userEmail}) gesendet.`);
            } else {
                console.log(`[SIMULATION MAIL] Begleitungs-Info an LiV: ${userEmail}`);
            }
        } catch (err) {
            console.error(`[MAIL-ERROR] Fehler beim Senden an Lehrkraft (${userEmail}):`, err);
        }
    }
}

/**
 * Sendet E-Mails bei Absage eines Unterrichtsbesuchs.
 */
async function sendUBCancelledMails(userEmail, userName, slEmail, slName, ubDetails) {
    const transportInfo = await getTransporter();
    const dateFormatted = formatDate(ubDetails.date_time);
    const eventUid = `ub-event-${ubDetails.id}@${(transportInfo ? transportInfo.from.split('@')[1] : 'ubportal.local') || 'ubportal.local'}`;

    const variables = {
        user_name: userName,
        user_email: userEmail,
        sl_name: slName || 'Nicht zugewiesen',
        sl_email: slEmail || '',
        subject: ubDetails.subject,
        grade: ubDetails.grade,
        room: ubDetails.room,
        type: ubDetails.type,
        date_time: dateFormatted
    };

    // Mail an LiV (Absagebestätigung)
    if (userEmail && userEmail.trim()) {
        try {
            const renderedLiv = await renderTemplate('ub_cancelled_liv', {
                ...variables,
                recipient_name: userName,
                recipient_email: userEmail
            });

            if (transportInfo) {
                await transportInfo.transporter.sendMail({
                    from: transportInfo.from,
                    to: userEmail,
                    subject: renderedLiv.subject,
                    text: renderedLiv.plainText,
                    html: renderedLiv.fullHtml
                });
                console.log(`[MAIL-SUCCESS] Absage-Bestätigung an Lehrkraft (${userEmail}) gesendet.`);
            } else {
                console.log(`[SIMULATION MAIL] Absage an LiV: ${userEmail}`);
            }
        } catch (err) {
            console.error(`[MAIL-ERROR] Fehler beim Senden der Absage an Lehrkraft (${userEmail}):`, err);
        }
    }

    // Mail an Schulleitung (mit iCal CANCEL)
    if (slEmail && slEmail.trim() && slName) {
        try {
            let cancelIcs = '';
            try {
                const title = `ABGESAGT: ${ubDetails.type}: ${ubDetails.subject} - ${userName}`;
                const description = `Dieser Termin wurde abgesagt.`;
                const location = `Raum ${ubDetails.room}`;
                const organizer = { 
                    name: userName, 
                    email: transportInfo ? transportInfo.from : 'mail@schule.de'
                };
                const attendee = { name: slName, email: slEmail };
                const icsCancelContent = await generateICS(title, description, location, ubDetails.date_time, organizer, attendee, eventUid);
                cancelIcs = icsCancelContent.replace('METHOD:REQUEST', 'METHOD:CANCEL').replace('STATUS:CONFIRMED', 'STATUS:CANCELLED');
            } catch (icsErr) {
                console.error('[MAIL-ERROR] Fehler bei Stornierungs-ICS-Generierung:', icsErr);
            }

            const renderedSl = await renderTemplate('ub_cancelled_sl', {
                ...variables,
                recipient_name: slName,
                recipient_email: slEmail
            });

            if (transportInfo) {
                const mailConfig = {
                    from: transportInfo.from,
                    to: slEmail,
                    subject: renderedSl.subject,
                    text: renderedSl.plainText,
                    html: renderedSl.fullHtml
                };

                if (cancelIcs) {
                    mailConfig.icalEvent = {
                        method: 'CANCEL',
                        content: cancelIcs
                    };
                }

                await transportInfo.transporter.sendMail(mailConfig);
                console.log(`[MAIL-SUCCESS] Absage-E-Mail mit Storno-iCal an Schulleitung (${slEmail}) gesendet.`);
            } else {
                console.log(`[SIMULATION MAIL] Absage an SL: ${slEmail}`);
            }
        } catch (err) {
            console.error(`[MAIL-ERROR] Fehler beim Senden der Absage an Schulleitung (${slEmail}):`, err);
        }
    }
}

module.exports = {
    getTransporter,
    renderTemplate,
    sendTestMail,
    sendUBSubmittedMail,
    sendDraftReminderMail,
    sendUnassignedSLReminderMail,
    sendUpcomingSLReminderMail,
    sendUBAssignedMails,
    sendUBCancelledMails
};
