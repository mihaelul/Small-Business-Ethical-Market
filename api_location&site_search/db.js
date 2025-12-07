const sql = require('mssql');

const useWindowsAuth = process.env.DB_USE_WINDOWS_AUTH === 'true' || process.env.DB_USE_WINDOWS_AUTH === '1';

let serverName = process.env.DB_SERVER || 'localhost';
const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined;

if (serverName.startsWith('.\\')) {
    const instanceName = serverName.substring(2);
    serverName = `localhost\\${instanceName}`;
    console.log(`Server normalizat: ${serverName}`);
} else if (serverName.startsWith('.')) {
    serverName = 'localhost';
}

const dbConfig = {
    server: serverName,
    database: process.env.DB_NAME || 'mockup',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true,
        enableArithAbort: true,
        instanceName: process.env.DB_INSTANCE || undefined
    },
    connectionTimeout: 60000,
    requestTimeout: 30000,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

if (port) {
    dbConfig.port = port;
}

if (!useWindowsAuth) {
    dbConfig.user = process.env.DB_USER || 'sa';
    dbConfig.password = process.env.DB_PASSWORD || '';
}

let pool = null;

async function connect() {
    try {
        if (!pool) {
            const configForLog = { ...dbConfig };
            if (configForLog.password) {
                configForLog.password = '***';
            }
            console.log(' Incercare conectare la SQL Server...');
            console.log(`   Server: ${dbConfig.server}`);
            if (dbConfig.port) {
                console.log(`   Port: ${dbConfig.port}`);
            }
            if (dbConfig.options.instanceName) {
                console.log(`   Instance: ${dbConfig.options.instanceName}`);
            }
            console.log(`   Database: ${dbConfig.database}`);
            console.log(`   Windows Auth: ${useWindowsAuth ? 'DA' : 'NU'}`);
            
            try {
                pool = await sql.connect(dbConfig);
            } catch (firstError) {
                if (serverName.includes('\\') && dbConfig.options.instanceName) {
                    console.log('   Reincercare fara instanceName n options...');
                    const retryConfig = { ...dbConfig };
                    delete retryConfig.options.instanceName;
                    pool = await sql.connect(retryConfig);
                } else {
                    throw firstError;
                }
            }
            console.log(' Conectat la SQL Server');
        }
        return pool;
    } catch (error) {
        console.error(' Eroare la conectare la baza de date:', error.message);
        console.error('   Verifică:');
        console.error('   - Serverul SQL Server rulează?');
        console.error('   - DB_SERVER este corect în .env?');
        console.error('   - Windows Authentication este activat?');
        throw error;
    }
}

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

async function saveBusiness(business) {
    try {
        await connect();
        
        const exists = await businessExists(business.name, business.address);
        if (exists) {
            return { success: false, skipped: true, reason: 'Business există deja' };
        }

        const nextId = await getNextBusinessId();

        let ratingValue = business.rating || 0;
        ratingValue = Math.max(0, Math.min(5, ratingValue));

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

async function tableExists(tableName) {
    try {
        await connect();
        const result = await pool.request()
            .input('tableName', sql.NVarChar(128), tableName)
            .query(`
                SELECT COUNT(*) AS Count 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_NAME = @tableName
            `);
        
        return result.recordset[0].Count > 0;
    } catch (error) {
        console.error(`Eroare la verificarea existenței tabelului ${tableName}:`, error.message);
        return false;
    }
}

async function listAllTables() {
    try {
        await connect();
        const result = await pool.request()
            .query(`
                SELECT TABLE_NAME 
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_NAME
            `);
        
        return result.recordset.map(row => row.TABLE_NAME);
    } catch (error) {
        console.error('Eroare la listarea tabelelor:', error.message);
        return [];
    }
}

async function getNextProductId() {
    try {
        await connect();
        const result = await pool.request()
            .query('SELECT ISNULL(MAX([ID_Produs]), 0) + 1 AS NextID FROM [dbo].[Produse]');
        
        return result.recordset[0].NextID;
    } catch (error) {
        console.error('Eroare la obținerea următorului ID produs:', error.message);
        const exists = await tableExists('Produse');
        if (!exists) {
            throw new Error('Tabelul Produse nu există în baza de date. Te rugăm să-l creezi mai întâi.');
        }
        throw error;
    }
}

async function productExists(nume, link) {
    try {
        await connect();
        const result = await pool.request()
            .input('nume', sql.NVarChar(sql.MAX), nume)
            .input('link', sql.NVarChar(sql.MAX), link)
            .query('SELECT [ID_Produs] FROM [dbo].[Produse] WHERE [Nume] = @nume AND [Link] = @link');
        
        if (result.recordset.length > 0) {
            return result.recordset[0].ID_Produs;
        }
        return null;
    } catch (error) {
        console.error('Eroare la verificarea existenței produsului:', error.message);
        return null;
    }
}

function cleanText(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    let cleaned = text.replace(/<[^>]*>/g, '');
    
    cleaned = cleaned.replace(/&nbsp;/g, ' ')
                     .replace(/&amp;/g, '&')
                     .replace(/&lt;/g, '<')
                     .replace(/&gt;/g, '>')
                     .replace(/&quot;/g, '"')
                     .replace(/&#39;/g, "'");
    
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
}

function extractProductName(text) {
    if (!text || typeof text !== 'string') {
        return 'Produs fără nume';
    }
    
    if (text.includes('<')) {
        const altMatch = text.match(/alt=["']([^"']+)["']/i);
        if (altMatch && altMatch[1]) {
            return cleanText(altMatch[1]);
        }
        
        const cleaned = cleanText(text);
        if (cleaned.length > 0) {
            return cleaned;
        }
    }
    
    return cleanText(text) || 'Produs fără nume';
}

function cleanPrice(price) {
    if (!price || typeof price !== 'string') {
        return 'N/A';
    }
    
    let cleaned = price.replace(/<[^>]*>/g, '');
    
    cleaned = cleaned.replace(/&nbsp;/g, ' ')
                     .replace(/&amp;/g, '&')
                     .replace(/&lt;/g, '<')
                     .replace(/&gt;/g, '>')
                     .replace(/&quot;/g, '"')
                     .replace(/&#39;/g, "'");
    
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
    
    if (!cleaned || cleaned.length === 0) {
        return 'N/A';
    }
    
    if (cleaned.length > 50) {
        cleaned = cleaned.substring(0, 50);
    }
    
    return cleaned;
}

function truncateText(text, maxLength = 50) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    if (text.length <= maxLength) {
        return text;
    }
    
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.7) {
        return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
}

async function getOrInsertProduct(product) {
    try {
        await connect();
        
        const cleanNume = truncateText(extractProductName(product.Nume || ''), 50);
        const cleanPret = cleanPrice(product.Pret || 'N/A');
        const cleanLink = cleanText(product.Link || '').substring(0, 200);
        const cleanBusiness = truncateText(cleanText(product.Site || 'Necunoscut'), 150);
        
        if (!cleanNume || cleanNume === 'Produs fără nume' || cleanNume.length < 3) {
            throw new Error('Numele produsului nu este valid sau conține doar HTML');
        }
        
        const existingId = await productExists(cleanNume, cleanLink);
        if (existingId !== null) {
            return existingId;
        }

        const result = await pool.request()
            .input('nume', sql.NVarChar(50), cleanNume)
            .input('pret', sql.NVarChar(50), cleanPret)
            .input('link', sql.NVarChar(200), cleanLink || null)
            .input('business', sql.NVarChar(150), cleanBusiness)
            .query(`
                INSERT INTO [dbo].[Produse] ([Nume], [Pret], [Link], [Business])
                OUTPUT INSERTED.[ID_Produs]
                VALUES (@nume, @pret, @link, @business)
            `);

        const insertedId = result.recordset[0].ID_Produs;
        return insertedId;
    } catch (error) {
        console.error(`Eroare la inserarea/obținerea produsului "${product.Nume}":`, error.message);
        throw error;
    }
}

async function getAllProducts() {
    try {
        await connect();
        const exists = await tableExists('Produse');
        if (!exists) {
            console.warn('⚠️  Tabelul Produse nu există. Returnez array gol.');
            const tables = await listAllTables();
            console.log('📋 Tabele disponibile în baza de date:', tables.join(', '));
            return [];
        }
        
        const result = await pool.request()
            .query('SELECT [ID_Produs], [Nume], [Pret], [Link], [Business] FROM [dbo].[Produse] ORDER BY [ID_Produs] DESC');
        
        return result.recordset.map(row => ({
            ID_produs: row.ID_Produs,
            Nume: row.Nume,
            Pret: row.Pret,
            Link: row.Link,
            Site: row.Business,
            Site_URL: null
        }));
    } catch (error) {
        console.error('Eroare la obținerea produselor:', error.message);
        try {
            const tables = await listAllTables();
            console.log('📋 Tabele disponibile în baza de date:', tables.join(', '));
        } catch (listError) {
        }
        console.warn('⚠️  Returnez array gol din cauza erorii.');
        return [];
    }
}

async function getNextOrderId() {
    try {
        await connect();
        const result = await pool.request()
            .query('SELECT ISNULL(MAX([ID_Comanda]), 0) + 1 AS NextID FROM [dbo].[Comanda]');
        
        return result.recordset[0].NextID;
    } catch (error) {
        console.error('Eroare la obținerea următorului ID comandă:', error.message);
        const exists = await tableExists('Comanda');
        if (!exists) {
            throw new Error('Tabelul Comanda nu există în baza de date. Te rugăm să-l creezi mai întâi.');
        }
        throw error;
    }
}

async function createOrder(idProdus) {
    try {
        await connect();
        
        const productCheck = await pool.request()
            .input('id_produs', sql.Int, idProdus)
            .query('SELECT COUNT(*) AS Count FROM [dbo].[Produse] WHERE [ID_Produs] = @id_produs');
        
        if (productCheck.recordset[0].Count === 0) {
            return { success: false, error: 'Produsul nu există' };
        }

        const result = await pool.request()
            .input('id_produs', sql.Int, idProdus)
            .query(`
                INSERT INTO [dbo].[Comanda] ([ID_Produs])
                OUTPUT INSERTED.[ID_Comanda]
                VALUES (@id_produs)
            `);

        const insertedId = result.recordset[0].ID_Comanda;
        return { success: true, id: insertedId };
    } catch (error) {
        console.error(`Eroare la crearea comenzii pentru produsul ${idProdus}:`, error.message);
        return { success: false, error: error.message };
    }
}

async function createOrders(productIds) {
    const stats = {
        created: 0,
        errors: 0,
        orderIds: []
    };

    for (const productId of productIds) {
        const result = await createOrder(productId);
        
        if (result.success) {
            stats.created++;
            stats.orderIds.push(result.id);
        } else {
            stats.errors++;
        }
    }

    return stats;
}

async function deleteOrder(orderId) {
    try {
        await connect();
        
        const orderCheck = await pool.request()
            .input('id_comanda', sql.Int, orderId)
            .query('SELECT COUNT(*) AS Count FROM [dbo].[Comanda] WHERE [ID_Comanda] = @id_comanda');
        
        if (orderCheck.recordset[0].Count === 0) {
            return { success: false, error: 'Comanda nu există' };
        }

        await pool.request()
            .input('id_comanda', sql.Int, orderId)
            .query('DELETE FROM [dbo].[Comanda] WHERE [ID_Comanda] = @id_comanda');

        return { success: true, message: 'Comandă ștearsă cu succes' };
    } catch (error) {
        console.error(`Eroare la ștergerea comenzii ${orderId}:`, error.message);
        return { success: false, error: error.message };
    }
}

async function getAllOrdersWithProducts() {
    try {
        await connect();
        
        const produseExists = await tableExists('Produse');
        const comandaExists = await tableExists('Comanda');
        
        if (!produseExists || !comandaExists) {
            console.warn('⚠️  Tabelele Produse sau Comanda nu există. Returnez array gol.');
            return [];
        }
        
        const result = await pool.request()
            .query(`
                SELECT 
                    c.[ID_Comanda],
                    c.[ID_Produs],
                    p.[Nume],
                    p.[Pret],
                    p.[Link],
                    p.[Business] as Site
                FROM [dbo].[Comanda] c
                INNER JOIN [dbo].[Produse] p ON c.[ID_Produs] = p.[ID_Produs]
                ORDER BY c.[ID_Comanda] DESC
            `);
        
        return result.recordset.map(row => ({
            ID_comanda: row.ID_Comanda,
            ID_produs: row.ID_Produs,
            Nume: row.Nume,
            Pret: row.Pret,
            Link: row.Link,
            Site: row.Site
        }));
    } catch (error) {
        console.error('Eroare la obținerea comenzilor:', error.message);
        return [];
    }
}

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
    getNextBusinessId,
    getOrInsertProduct,
    getAllProducts,
    getNextOrderId,
    createOrder,
    createOrders,
    deleteOrder,
    getAllOrdersWithProducts,
    tableExists,
    listAllTables
};
