require('dotenv').config();
const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs').promises;

//new
const { getAllProducts, getOrInsertProduct, createOrder, createOrders, deleteOrder, getAllOrdersWithProducts } = require('./db');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'site logica')));

// Endpoint for search.js with a keyword
app.post('/api/search', async (req, res) => {
    const keyword = req.body.keyword || req.query.keyword;
    
    if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
    }

    console.log(`Cautare pentru: ${keyword}`);

    // search.js with received keyword
    exec(`node search.js "${keyword}"`, { cwd: __dirname }, async (error, stdout, stderr) => {
        if (error) {
            console.error(`Eroare: ${error.message}`);
            return res.status(500).json({ error: 'Eroare la executarea cautarii', details: error.message });
        }

        if (stderr) {
            console.error(`Stderr: ${stderr}`);
        }

        console.log(`Cautare completa pentru: ${keyword}`);

       
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

// Endpoint for fetching products from database (for buy page)
app.get('/api/buy/products', async (req, res) => {
    try {
        const products = await getAllProducts();
        
        res.json({ 
            success: true, 
            products: products,
            count: products.length
        });
    } catch (error) {
        console.error(`Eroare la obtinerea produselor din baza de date: ${error.message}`);
        res.status(500).json({ error: 'Eroare la obtinerea produselor', details: error.message });
    }
});

app.post('/api/products/sync', async (req, res) => {
    try {
        const productsPath = path.join(__dirname, 'site logica', 'top-products.json');
        const productsData = await fs.readFile(productsPath, 'utf8');
        const products = JSON.parse(productsData);
        
        const syncedProducts = [];
        for (const product of products) {
            const productId = await getOrInsertProduct(product);
            syncedProducts.push({ ...product, ID_produs: productId });
        }
        
        res.json({ 
            success: true, 
            message: `Sincronizate ${syncedProducts.length} produse`,
            products: syncedProducts
        });
    } catch (error) {
        console.error(`Eroare la sincronizarea produselor: ${error.message}`);
        res.status(500).json({ error: 'Eroare la sincronizarea produselor', details: error.message });
    }
});

// Endpoint for placing an order
app.post('/api/orders', async (req, res) => {
    try {
        const { productId } = req.body;
        
        if (!productId) {
            return res.status(400).json({ error: 'productId is required' });
        }

        const result = await createOrder(productId);
        
        if (result.success) {
            res.json({ 
                success: true, 
                message: 'Comanda creata cu succes',
                orderId: result.id
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: result.error 
            });
        }
    } catch (error) {
        console.error(`Eroare la crearea comenzii: ${error.message}`);
        res.status(500).json({ error: 'Eroare la crearea comenzii', details: error.message });
    }
});

// Endpoint  for placing multiple orders
app.post('/api/orders/batch', async (req, res) => {
    try {
        const { productIds } = req.body;
        
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ error: 'productIds array is required' });
        }

        const result = await createOrders(productIds);
        
        res.json({ 
            success: true, 
            message: `Create ${result.created} comenzi`,
            created: result.created,
            errors: result.errors,
            orderIds: result.orderIds
        });
    } catch (error) {
        console.error(`Eroare la crearea comenzilor: ${error.message}`);
        res.status(500).json({ error: 'Eroare la crearea comenzilor', details: error.message });
    }
});

// Endpoint for adding a product to an order
app.post('/api/cart/add', async (req, res) => {
    try {
        const product = req.body;
        
        if (!product || !product.Nume) {
            return res.status(400).json({ error: 'Product data is required (Nume, Pret, Link, Site)' });
        }

        const productId = await getOrInsertProduct(product);
        
        const orderResult = await createOrder(productId);
        
        if (orderResult.success) {
            res.json({ 
                success: true, 
                message: 'Produs adăugat în coș cu succes',
                productId: productId,
                orderId: orderResult.id
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: orderResult.error 
            });
        }
    } catch (error) {
        console.error(`Eroare la adăugarea produsului în coș: ${error.message}`);
        res.status(500).json({ error: 'Eroare la adăugarea produsului în coș', details: error.message });
    }
});

// Endpointfor fetching all orders(for buy page) 
app.get('/api/buy/orders', async (req, res) => {
    try {
        const orders = await getAllOrdersWithProducts();
        
        res.json({ 
            success: true, 
            orders: orders,
            count: orders.length
        });
    } catch (error) {
        console.error(`Eroare la obținerea comenzilor: ${error.message}`);
        res.status(500).json({ error: 'Eroare la obținerea comenzilor', details: error.message });
    }
});

// Endpoint for deleting an order
app.delete('/api/orders/:orderId', async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId);
        
        if (!orderId || isNaN(orderId)) {
            return res.status(400).json({ error: 'ID-ul comenzii este invalid' });
        }

        const result = await deleteOrder(orderId);
        
        if (result.success) {
            res.json({ 
                success: true, 
                message: result.message || 'Comandă ștearsă cu succes'
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: result.error 
            });
        }
    } catch (error) {
        console.error(`Eroare la ștergerea comenzii: ${error.message}`);
        res.status(500).json({ error: 'Eroare la ștergerea comenzii', details: error.message });
    }
});


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'main2.html'));
});

app.get('/main.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'main2.html'));
});

app.get('/main2.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'main2.html'));
});

app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'profile.html'));
});

app.get('/product.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'product.html'));
});

app.get('/search-results.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'search-results.html'));
});

app.get('/buy.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'site logica', 'buy.html'));
}); //nou

app.listen(PORT, () => {
    console.log(` Server rulând pe http://localhost:${PORT}`);
    console.log(` Fișiere statice servite din: site logica/`);
});

