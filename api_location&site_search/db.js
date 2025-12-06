const sql = require('mssql');

// Verifică dacă se folosește Windows Authentication
const useWindowsAuth = process.env.DB_USE_WINDOWS_AUTH === 'true' || process.env.DB_USE_WINDOWS_AUTH === '1';

// Obține serverul și portul (dacă este specificat)
let serverName = process.env.DB_SERVER || 'localhost';
const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined;

// Normalizează serverul: .\SQLEXPRESS2 sau .\INSTANCE -> localhost\INSTANCE
// mssql nu acceptă .\ pentru localhost
if (serverName.startsWith('.\\')) {
    const instanceName = serverName.substring(2); // Elimină .\
    serverName = `localhost\\${instanceName}`;
    console.log(`⚠️  Server normalizat: ${serverName}`);
} else if (serverName.startsWith('.')) {
    // Dacă e doar . sau .\ fără instance
    serverName = 'localhost';
}

// Configurare conexiune SQL Server
const dbConfig = {
    server: serverName,
    database: process.env.DB_NAME || 'mockup',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true', // Folosește true pentru Azure
        trustServerCertificate: true, // Pentru development
        enableArithAbort: true,
        instanceName: process.env.DB_INSTANCE || undefined // Pentru named instances
    },
    connectionTimeout: 60000, // 60 secunde timeout (mărit pentru named instances)
    requestTimeout: 30000,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Adaugă port dacă este specificat
if (port) {
    dbConfig.port = port;
}

// Pentru Windows Authentication, nu includem user/password
// Pentru SQL Authentication, adăugăm user/password
if (!useWindowsAuth) {
    dbConfig.user = process.env.DB_USER || 'sa';
    dbConfig.password = process.env.DB_PASSWORD || '';
}
// Dacă useWindowsAuth este true, nu includem user/password
// mssql va folosi automat Windows Authentication

let pool = null;

/**
 * Conectează la baza de date SQL Server
 * @returns {Promise<sql.ConnectionPool>} Pool-ul de conexiuni
 */
async function connect() {
    try {
        if (!pool) {
            // Log configurația (fără parolă)
            const configForLog = { ...dbConfig };
            if (configForLog.password) {
                configForLog.password = '***';
            }
            console.log('🔌 Încercare conectare la SQL Server...');
            console.log(`   Server: ${dbConfig.server}`);
            if (dbConfig.port) {
                console.log(`   Port: ${dbConfig.port}`);
            }
            if (dbConfig.options.instanceName) {
                console.log(`   Instance: ${dbConfig.options.instanceName}`);
            }
            console.log(`   Database: ${dbConfig.database}`);
            console.log(`   Windows Auth: ${useWindowsAuth ? 'DA' : 'NU'}`);
            
            // Pentru named instances, încercăm mai multe variante
            try {
                pool = await sql.connect(dbConfig);
            } catch (firstError) {
                // Dacă eșuează și avem named instance, încercăm fără instanceName în options
                if (serverName.includes('\\') && dbConfig.options.instanceName) {
                    console.log('   ⚠️  Reîncercare fără instanceName în options...');
                    const retryConfig = { ...dbConfig };
                    delete retryConfig.options.instanceName;
                    pool = await sql.connect(retryConfig);
                } else {
                    throw firstError;
                }
            }
            console.log('✅ Conectat la SQL Server');
        }
        return pool;
    } catch (error) {
        console.error('❌ Eroare la conectare la baza de date:', error.message);
        console.error('   Verifică:');
        console.error('   - Serverul SQL Server rulează?');
        console.error('   - DB_SERVER este corect în .env?');
        console.error('   - Windows Authentication este activat?');
        throw error;
    }
}

/**
 * Obține următorul ID disponibil pentru Businesses
 * @returns {Promise<number>} Următorul ID disponibil
 */
async function getNextBusinessId() {
    try {
        await connect();
        const result = await pool.request()
            .query('SELECT ISNULL(MAX(ID_Business), 0) + 1 AS NextID FROM Businesses');
        
        return result.recordset[0].NextID;
    } catch (error) {
        console.error('Eroare la obținerea următorului ID:', error.message);
        throw error;
    }
}

/**
 * Verifică dacă un business există deja (după Denumire și Adresa)
 * @param {string} name - Denumirea business-ului
 * @param {string} address - Adresa business-ului
 * @returns {Promise<boolean>} True dacă există, False altfel
 */
async function businessExists(name, address) {
    try {
        await connect();
        const result = await pool.request()
            .input('denumire', sql.VarChar(150), name)
            .input('adresa', sql.VarChar(150), address)
            .query('SELECT COUNT(*) AS Count FROM Businesses WHERE Denumire = @denumire AND Adresa = @adresa');
        
        return result.recordset[0].Count > 0;
    } catch (error) {
        console.error('Eroare la verificarea existenței business-ului:', error.message);
        return false;
    }
}

/**
 * Salvează un business în baza de date
 * @param {object} business - Obiectul business-ului
 * @returns {Promise<object>} Rezultatul operației { success: boolean, id: number }
 */
async function saveBusiness(business) {
    try {
        await connect();
        
        // Verifică dacă există deja
        const exists = await businessExists(business.name, business.address);
        if (exists) {
            return { success: false, skipped: true, reason: 'Business există deja' };
        }

        // Obține următorul ID
        const nextId = await getNextBusinessId();

        // Google Maps returnează rating 0-5, tabelul cere 0-5 (CHECK constraint)
        // Păstrăm rating-ul în formatul 0-5
        let ratingValue = business.rating || 0;
        // Asigură-te că rating-ul este în intervalul 0-5 (conform constraint-ului din tabel)
        ratingValue = Math.max(0, Math.min(5, ratingValue));

        // Inserează business-ul
        await pool.request()
            .input('id', sql.Int, nextId)
            .input('denumire', sql.VarChar(150), business.name)
            .input('adresa', sql.VarChar(150), business.address || null)
            .input('rating', sql.Decimal(10, 2), ratingValue)
            .input('nr_reviews', sql.Int, business.totalRatings || 0)
            .query(`
                INSERT INTO Businesses (ID_Business, Denumire, Adresa, Rating, Nr_Reviews)
                VALUES (@id, @denumire, @adresa, @rating, @nr_reviews)
            `);

        return { success: true, id: nextId };
    } catch (error) {
        console.error(`Eroare la salvarea business-ului "${business.name}":`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Salvează mai multe business-uri în baza de date
 * @param {Array<object>} businesses - Lista de business-uri
 * @returns {Promise<object>} Statistici: { saved: number, skipped: number, errors: number }
 */
async function saveBusinesses(businesses) {
    const stats = {
        saved: 0,
        skipped: 0,
        errors: 0
    };

    console.log(`\n💾 Salvare ${businesses.length} business-uri în baza de date...`);

    for (const business of businesses) {
        const result = await saveBusiness(business);
        
        if (result.success) {
            stats.saved++;
        } else if (result.skipped) {
            stats.skipped++;
        } else {
            stats.errors++;
        }
    }

    return stats;
}

/**
 * Închide conexiunea la baza de date
 */
async function closeConnection() {
    try {
        if (pool) {
            await pool.close();
            pool = null;
            console.log('✅ Conexiunea la baza de date închisă');
        }
    } catch (error) {
        console.error('Eroare la închiderea conexiunii:', error.message);
    }
}

module.exports = {
    connect,
    saveBusiness,
    saveBusinesses,
    closeConnection,
    businessExists,
    getNextBusinessId
};

