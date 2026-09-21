const { getDatabase } = require('./db');
const {
    sendDraftReminderMail,
    sendUnassignedSLReminderMail,
    sendUpcomingSLReminderMail
} = require('./mailer');

let schedulerInterval = null;

/**
 * Führt die periodische Prüfung auf fällige Erinnerungen durch.
 */
async function checkAndSendReminders() {
    try {
        const db = await getDatabase();
        const now = new Date();
        const currentHour = now.getHours();

        // Bestimme das Datum von "morgen"
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
        const dayAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0, 0);

        // Alle aktiven, eingereichten UBs abrufen, die noch nicht abgesagt oder archiviert sind
        const ubs = await db.all(`
            SELECT ub.*, u.display_name as user_name, u.email as user_email,
                   sl.display_name as assigned_sl_name, sl.email as assigned_sl_email
            FROM unterrichtsbesuche ub
            JOIN users u ON ub.user_id = u.id
            LEFT JOIN users sl ON ub.assigned_schulleitung_id = sl.id
            WHERE ub.status = 'submitted'
        `);

        for (const ub of ubs) {
            const ubDate = new Date(ub.date_time);
            const isTomorrow = ubDate >= tomorrow && ubDate < dayAfterTomorrow;

            if (!isTomorrow) {
                continue;
            }

            // c. Erinnerung an LiV, wenn kein Entwurf hochgeladen wurde (ab 9:00 Uhr am Vortag)
            if (currentHour >= 9 && (!ub.file_path || ub.file_path.trim() === '') && !ub.reminded_draft_liv) {
                console.log(`[SCHEDULER] Sende Erinnerung fehlender Entwurf (c) für UB-ID ${ub.id} an LiV ${ub.user_email}...`);
                await sendDraftReminderMail(ub.user_email, ub.user_name, ub);
                await db.run('UPDATE unterrichtsbesuche SET reminded_draft_liv = 1 WHERE id = ?', [ub.id]);
            }

            // d. Erinnerung an alle SL-Mitglieder, wenn UB noch nicht zugewiesen wurde (ab 9:00 Uhr am Vortag)
            if (currentHour >= 9 && (!ub.assigned_schulleitung_id || ub.assigned_schulleitung_id === '') && !ub.reminded_unassigned_sl) {
                console.log(`[SCHEDULER] Sende Erinnerung nicht zugewiesen (d) für UB-ID ${ub.id} an Schulleitung...`);
                await sendUnassignedSLReminderMail(ub.user_name, ub.user_email, ub);
                await db.run('UPDATE unterrichtsbesuche SET reminded_unassigned_sl = 1 WHERE id = ?', [ub.id]);
            }

            // e. Erinnerung an zugewiesenes SL-Mitglied, dass UB morgen stattfindet (ab 10:00 Uhr am Vortag)
            if (currentHour >= 10 && ub.assigned_schulleitung_id && ub.assigned_sl_email && !ub.reminded_upcoming_sl) {
                console.log(`[SCHEDULER] Sende Terminerinnerung (e) für UB-ID ${ub.id} an SL ${ub.assigned_sl_email}...`);
                await sendUpcomingSLReminderMail(ub.assigned_sl_email, ub.assigned_sl_name, ub.user_name, ub.user_email, ub);
                await db.run('UPDATE unterrichtsbesuche SET reminded_upcoming_sl = 1 WHERE id = ?', [ub.id]);
            }
        }
    } catch (err) {
        console.error('[SCHEDULER-ERROR] Fehler bei der Ausführung des Erinnerungs-Schedulers:', err);
    }
}

/**
 * Startet den Scheduler (Intervall alle 60 Sekunden).
 */
function startScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
    }

    console.log('[SCHEDULER] Unterrichtsbesuch-Erinnerungs-Scheduler gestartet (Intervall: 60 Sekunden).');
    // Einmalig beim Start prüfen
    checkAndSendReminders();

    // Danach minütlich prüfen
    schedulerInterval = setInterval(checkAndSendReminders, 60 * 1000);
}

function stopScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        console.log('[SCHEDULER] Erinnerungs-Scheduler gestoppt.');
    }
}

module.exports = {
    startScheduler,
    stopScheduler,
    checkAndSendReminders
};
