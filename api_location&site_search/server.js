require('dotenv').config();
const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;

// Middleware pentru JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servește fișierele statice din "site logica"
app.use(express.static(path.join(__dirname, 'site logica')));

// Endpoint pentru a rula search.js cu un keyword
app.post('/api/search', async (req, res) => {
    const keyword = req.body.keyword || req.query.keyword;
    
    if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
    }

    console.log(`🔍 Căutare pentru: ${keyword}`);

    // Rulează search.js cu keyword-ul primit
    exec(`node search.js "${keyword}"`, { cwd: __dirname }, async (error, stdout, stderr) => {
        if (error) {
            console.error(`Eroare: ${error.message}`);
            return res.status(500).json({ error: 'Eroare la executarea căutării', details: error.message });
        }

        if (stderr) {
            console.error(`Stderr: ${stderr}`);
        }

        console.log(`✅ Căutare completă pentru: ${keyword}`);

        // Citește produsele actualizate din top-products.json
        try {
            const productsPath = path.join(__dirname, 'site logica', 'top-products.json');
            const productsData = await fs.readFile(productsPath, 'utf8');
            const products = JSON.parse(productsData);
            
            res.json({ 
                success: true, 
                products: products,
                count: products.length,
                keyword: keyword
            });
        } catch (readError) {
            console.error(`Eroare la citirea produselor: ${readError.message}`);
            res.status(500).json({ error: 'Eroare la citirea produselor', details: readError.message });
        }
    });
});

// Endpoint pentru a obține produsele curente
app.get('/api/products', async (req, res) => {
    try {
        const productsPath = path.join(__dirname, 'site logica', 'top-products.json');
        const productsData = await fs.readFile(productsPath, 'utf8');
        const products = JSON.parse(productsData);
        
        res.json({ 
            success: true, 
            products: products,
            count: products.length
        });
    } catch (error) {
        console.error(`Eroare la citirea produselor: ${error.message}`);
        res.status(500).json({ error: 'Eroare la citirea produselor', details: error.message });
    }
});

// Rute pentru paginile HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'main.html'));
});

app.get('/main.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'main.html'));
});

app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'profile.html'));
});

app.get('/product.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'product.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server rulând pe http://localhost:${PORT}`);
    console.log(`📂 Fișiere statice servite din: site logica/`);
});

