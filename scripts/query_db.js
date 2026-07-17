const { getDatabase } = require('../db');

const query = process.argv[2];

if (!query) {
    console.error('Bitte geben Sie eine SQL-Abfrage als Argument an. Beispiel: node scripts/query_db.js "SELECT * FROM users"');
    process.exit(1);
}

async function run() {
    try {
        const db = await getDatabase();
        if (query.trim().toUpperCase().startsWith('SELECT')) {
            const rows = await db.all(query);
            console.log(JSON.stringify(rows, null, 2));
        } else {
            const result = await db.run(query);
            console.log(JSON.stringify(result, null, 2));
        }
    } catch (err) {
        console.error('Fehler bei der Ausführung der Abfrage:', err.message);
        process.exit(1);
    }
}

run();
