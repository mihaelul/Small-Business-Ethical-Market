require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');

// Configurare
const API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyCgsbGSK3h6skaM1cAinmyUAulC2rFy5wo';
const MAX_RESULTS = 50; // Numărul maxim de rezultate dorite

// Tipuri de locuri legate de cazare care trebuie excluse
const LODGING_TYPES = [
    'lodging',
    'hotel',
    'motel',
    'hostel',
    'resort',
    'bed_and_breakfast',
    'guest_house',
    'apartment',
    'extended_stay'
];

/**
 * Verifică dacă un loc este o cazare (hotel, motel, etc.)
 * @param {Array<string>} types - Lista de tipuri de loc din Google Places API
 * @returns {boolean} True dacă este cazare, False altfel
 */
function isLodging(types) {
    if (!types || !Array.isArray(types)) {
        return false;
    }
    return types.some(type => LODGING_TYPES.includes(type));
}

/**
 * Obține detalii despre un place folosind Places API Details
 * @param {string} placeId - Place ID-ul business-ului
 * @returns {Promise<string|null>} Website-ul business-ului sau null
 */
async function getPlaceWebsite(placeId) {
    try {
        const baseUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
        const params = new URLSearchParams({
            key: API_KEY,
            place_id: placeId,
            fields: 'website'
        });

        const url = `${baseUrl}?${params.toString()}`;
        const response = await fetch(url);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        if (data.status === 'OK' && data.result && data.result.website) {
            return data.result.website;
        }

        return null;
    } catch (error) {
        // Ignoră erorile pentru website - nu este critic
        return null;
    }
}

/**
 * Caută business-uri folosind Google Maps Places API
 * @param {string} category - Categoria de căutat (ex: "bookstore", "restaurant", "clothing store")
 * @param {object} location - Coordonatele locației { lat: number, lng: number }
 * @param {number} radius - Raza de căutare în metri (default: 5000m = 5km)
 * @returns {Promise<Array>} Lista de business-uri găsite (fără cazări)
 */
async function searchBusinesses(category, location, radius = 5000) {
    const baseUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
    const allResults = [];
    let nextPageToken = null;
    let requestCount = 0;
    const maxRequests = 3; // Google permite max 3 pagini (60 rezultate total)

    try {
        do {
            // Construiește parametrii pentru request
            const params = new URLSearchParams({
                key: API_KEY,
                location: `${location.lat},${location.lng}`,
                radius: radius.toString(),
                keyword: category,
                type: getPlaceType(category) // Încearcă să mapeze categoria la un tip Google Maps
            });

            // Dacă avem un next_page_token, adaugă-l pentru paginare
            if (nextPageToken) {
                params.delete('location');
                params.delete('radius');
                params.delete('keyword');
                params.delete('type');
                params.set('pagetoken', nextPageToken);
                // Așteaptă puțin - Google necesită timp pentru a genera token-ul
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            const url = `${baseUrl}?${params.toString()}`;
            console.log(`🔍 Request ${requestCount + 1}: Căutare "${category}"...`);

            // Face fetch la API
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Verifică erori
            if (data.status === 'REQUEST_DENIED') {
                throw new Error(`API Error: ${data.error_message || 'Request denied. Verifică API key-ul.'}`);
            }
            
            if (data.status === 'INVALID_REQUEST') {
                throw new Error(`API Error: ${data.error_message || 'Request invalid.'}`);
            }

            if (data.status === 'ZERO_RESULTS') {
                console.log('⚠️ Nu s-au găsit rezultate pentru această categorie.');
                break;
            }

            if (data.status !== 'OK') {
                throw new Error(`API Error: ${data.status} - ${data.error_message || 'Unknown error'}`);
            }

            // Adaugă rezultatele la listă (excluzând cazările)
            if (data.results && data.results.length > 0) {
                // Filtrează cazările
                const filteredResults = data.results.filter(place => {
                    const placeTypes = place.types || [];
                    return !isLodging(placeTypes);
                });

                const formattedResults = filteredResults.map(place => ({
                    name: place.name,
                    placeId: place.place_id,
                    address: place.vicinity || place.formatted_address,
                    location: {
                        lat: place.geometry.location.lat,
                        lng: place.geometry.location.lng
                    },
                    rating: place.rating || null,
                    totalRatings: place.user_ratings_total || 0,
                    priceLevel: place.price_level || null,
                    types: place.types || [],
                    isOpen: place.opening_hours?.open_now || null
                }));

                const excludedCount = data.results.length - filteredResults.length;
                if (excludedCount > 0) {
                    console.log(`🚫 Excluse ${excludedCount} cazări din rezultate`);
                }

                allResults.push(...formattedResults);
                console.log(`✅ Găsite ${formattedResults.length} business-uri (Total: ${allResults.length})`);
            }

            // Verifică dacă există mai multe pagini
            nextPageToken = data.next_page_token || null;
            requestCount++;

            // Oprește dacă am ajuns la limita dorită sau la limita de requests
            if (allResults.length >= MAX_RESULTS || !nextPageToken || requestCount >= maxRequests) {
                break;
            }

        } while (nextPageToken && allResults.length < MAX_RESULTS);

        // Limitează la MAX_RESULTS
        const limitedResults = allResults.slice(0, MAX_RESULTS);

        // Obține website-ul pentru fiecare business
        console.log('\n🌐 Obținere website-uri pentru business-uri...');
        for (let i = 0; i < limitedResults.length; i++) {
            const business = limitedResults[i];
            const website = await getPlaceWebsite(business.placeId);
            business.website = website;
            
            // Mici pauze între request-uri pentru a evita rate limiting
            if (i < limitedResults.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        console.log('✅ Website-uri obținute');

        return limitedResults;

    } catch (error) {
        console.error('❌ Eroare la căutare:', error.message);
        throw error;
    }
}

/**
 * Mapează categoria dată de user la un tip Google Places API
 * @param {string} category - Categoria în română sau engleză
 * @returns {string} Tipul Google Places API
 */
function getPlaceType(category) {
    const categoryMap = {
        // Cărți
        'carti': 'book_store',
        'bookstore': 'book_store',
        'librarie': 'book_store',
        'books': 'book_store',
        
        // Mâncare
        'mancare': 'restaurant',
        'restaurant': 'restaurant',
        'food': 'restaurant',
        'mancare rapida': 'meal_takeaway',
        'fast food': 'meal_takeaway',
        'pizza': 'meal_delivery',
        'pizzerie': 'meal_delivery',
        'cafe': 'cafe',
        'cafenea': 'cafe',
        'coffee': 'cafe',
        
        // Haine
        'haine': 'clothing_store',
        'clothing': 'clothing_store',
        'fashion': 'clothing_store',
        'imbracaminte': 'clothing_store',
        
        // Altele
        'farmacie': 'pharmacy',
        'pharmacy': 'pharmacy',
        'supermarket': 'supermarket',
        'magazin': 'store',
        'shop': 'store'
    };

    const normalizedCategory = category.toLowerCase().trim();
    return categoryMap[normalizedCategory] || null; // Returnează null dacă nu găsește, va folosi doar keyword
}

/**
 * Salvează business-urile local într-un fișier JSON
 * Elimină duplicatele după website (salvează doar prima apariție)
 * Suprascrie fișierul existent cu noile date (șterge datele vechi)
 * @param {Array<object>} businesses - Lista de business-uri
 * @returns {Promise<string>} Calea către fișierul salvat
 */
async function saveBusinessesLocal(businesses) {
    // Structura simplificată: doar câmpurile necesare
    const simplifiedBusinesses = businesses.map(business => ({
        Denumire: business.name,
        Adresa: business.address || null,
        Rating: business.rating || 0,
        Nr_Reviews: business.totalRatings || 0,
        Website: business.website || null
    }));

    // Elimină locațiile fără website și duplicatele după website
    const seenWebsites = new Set();
    let uniqueBusinesses = simplifiedBusinesses.filter(business => {
        // Exclude locațiile fără website
        if (!business.Website) {
            return false;
        }
        
        // Normalizează website-ul (lowercase, fără trailing slash)
        const normalizedWebsite = business.Website.toLowerCase().replace(/\/$/, '');
        
        // Dacă am văzut deja acest website, îl excludem (duplicat)
        if (seenWebsites.has(normalizedWebsite)) {
            return false;
        }
        
        // Adaugă website-ul la set și păstrează business-ul
        seenWebsites.add(normalizedWebsite);
        return true;
    });

    const duplicatesRemoved = simplifiedBusinesses.length - uniqueBusinesses.length;
    if (duplicatesRemoved > 0) {
        console.log(`🔍 Eliminate ${duplicatesRemoved} duplicate după website`);
    }

    // Filtrează locațiile fără review-uri (Nr_Reviews = 0 sau null)
    const businessesWithReviews = uniqueBusinesses.filter(business => {
        return business.Nr_Reviews && business.Nr_Reviews > 0;
    });

    const noReviewsRemoved = uniqueBusinesses.length - businessesWithReviews.length;
    if (noReviewsRemoved > 0) {
        console.log(`🔍 Eliminate ${noReviewsRemoved} locații fără review-uri`);
    }

    // Sortează business-urile: prioritizează rating-ul, dar dacă rating-urile sunt asemănătoare,
    // preferă cel cu mai puține review-uri
    // Folosește o formulă care combină rating-ul și numărul de review-uri
    // cu o pondere mai mare pentru rating, dar care penalizează review-urile multe
    businessesWithReviews.sort((a, b) => {
        const reviewsA = a.Nr_Reviews || 0;
        const reviewsB = b.Nr_Reviews || 0;
        const ratingA = a.Rating || 0;
        const ratingB = b.Rating || 0;
        
        // Threshold pentru diferența de rating (dacă e mai mică decât aceasta, considerăm rating-urile asemănătoare)
        const ratingThreshold = 0.2;
        const ratingDiff = Math.abs(ratingA - ratingB);
        
        // Dacă diferența de rating e semnificativă (>= threshold), prioritizează rating-ul
        if (ratingDiff >= ratingThreshold) {
            return ratingB - ratingA; // Descendent după rating
        }
        
        // Dacă rating-urile sunt asemănătoare (diferență < threshold), preferă cel cu mai puține review-uri
        // Dar totuși ține cont de rating (dacă unul e puțin mai bun, dar are mult mai multe review-uri,
        // preferă-l pe cel cu rating puțin mai mic dar cu semnificativ mai puține review-uri)
        
        // Calculează un score combinat: rating * 1000 - reviews * 2
        // Astfel rating-ul are pondere mare, dar review-urile multe penalizează mai mult
        const scoreA = ratingA * 1000 - reviewsA * 2;
        const scoreB = ratingB * 1000 - reviewsB * 2;
        
        // Sortează descendent după score (score mai mare = mai sus)
        return scoreB - scoreA;
    });

    // Folosește un singur fișier care se actualizează la fiecare căutare
    const filename = 'businesses.json';
    const filepath = path.join(__dirname, filename);

    // Suprascrie fișierul existent cu noile date sortate (șterge datele vechi)
    await fs.writeFile(filepath, JSON.stringify(businessesWithReviews, null, 2), 'utf8');
    console.log(`💾 Datele au fost actualizate și sortate în: ${filename} (${businessesWithReviews.length} business-uri unice cu review-uri)`);
    console.log(`📊 Sortare: prioritizează Rating (dacă diferența >= 0.2), altfel Score = Rating * 1000 - Reviews * 2`);
    
    return filepath;
}

/**
 * Șterge un fișier local
 * @param {string} filepath - Calea către fișier
 */
async function deleteLocalFile(filepath) {
    try {
        await fs.unlink(filepath);
        console.log(`🗑️  Fișierul ${path.basename(filepath)} a fost șters`);
    } catch (error) {
        console.warn(`⚠️  Nu s-a putut șterge fișierul: ${error.message}`);
    }
}


/**
 * Verifică dacă un link pare a fi o categorie (nu un produs)
 * @param {string} text - Textul link-ului
 * @param {string} href - URL-ul link-ului
 * @returns {boolean} True dacă pare a fi categorie
 */
function isCategoryLink(text, href) {
    const textLower = text.toLowerCase();
    const hrefLower = href.toLowerCase();
    
    // Indicatori că e categorie:
    // - Text scurt și generic (ex: "Chitara electrica", "Chitara acustica")
    // - Nu conține nume de brand sau model specific
    // - Link-ul conține doar numele categoriei
    const categoryIndicators = [
        /^(chitara|guitar|pian|piano|tobe|drum)\s*(electric|acustic|clasic|bass)?$/i,
        /^[a-z\s]+$/i // Doar litere și spații, fără numere sau caractere speciale
    ];
    
    const isShortGeneric = text.length < 30 && categoryIndicators.some(pattern => pattern.test(text));
    const hasNoNumbers = !/\d/.test(text);
    const hasNoBrand = !/(yamaha|fender|gibson|ibanez|epiphone|cort|squier|martin|taylor)/i.test(text);
    
    return isShortGeneric && hasNoNumbers && hasNoBrand;
}

/**
 * Extrage produse dintr-o pagină de categorie sau produse
 * @param {string} pageUrl - URL-ul paginii
 * @param {string} searchQuery - Căutarea
 * @returns {Promise<Array>} Lista de produse
 */
async function extractProductsFromPage(pageUrl, searchQuery) {
    const products = [];
    const keywords = searchQuery.toLowerCase().split(/\s+/);
    
    try {
        const response = await fetch(pageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) return products;
        
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Caută produse folosind selectori comuni pentru e-commerce
        const productSelectors = [
            '.product', '.produs', '.product-item', '.product-card',
            '[class*="product"]', '[class*="produs"]', '[class*="item"]',
            'article', '.grid-item', '.shop-item'
        ];
        
        // Strategia 1: Caută elemente cu clase de produse
        productSelectors.forEach(selector => {
            $(selector).each((i, elem) => {
                if (products.length >= 15) return false;
                
                const $elem = $(elem);
                const $link = $elem.find('a').first();
                const href = $link.attr('href');
                const text = $link.text().trim() || $elem.find('h1, h2, h3, h4, .title, .name').first().text().trim();
                
                if (!text || text.length < 10) return;
                
                // Verifică dacă textul conține cuvinte cheie
                const textLower = text.toLowerCase();
                const matchesKeyword = keywords.some(keyword => textLower.includes(keyword));
                
                if (!matchesKeyword) return;
                
                // Caută preț
                let price = 'N/A';
                const priceSelectors = ['.price', '.pret', '[class*="price"]', '[class*="pret"]', '.amount'];
                priceSelectors.forEach(priceSel => {
                    const $price = $elem.find(priceSel).first();
                    if ($price.length) {
                        const priceText = $price.text().trim();
                        const priceMatch = priceText.match(/[\d.,]+\s*(?:lei|ron|€|eur|lei|ron)/i);
                        if (priceMatch) {
                            price = priceMatch[0];
                        } else if (priceText.match(/\d/)) {
                            price = priceText;
                        }
                    }
                });
                
                // Construiește URL complet
                let fullUrl = href || pageUrl;
                if (href && !href.startsWith('http')) {
                    try {
                        const baseUrl = new URL(pageUrl);
                        fullUrl = href.startsWith('/') 
                            ? baseUrl.origin + href 
                            : baseUrl.origin + '/' + href;
                    } catch (e) {
                        fullUrl = pageUrl;
                    }
                }
                
                // Verifică dacă nu e deja adăugat
                const isDuplicate = products.some(p => p.Link === fullUrl);
                if (!isDuplicate) {
                    products.push({
                        Nume: text,
                        Pret: price,
                        Link: fullUrl
                    });
                }
            });
        });
        
        // Strategia 2: Dacă nu găsim produse, caută link-uri cu prețuri
        if (products.length === 0) {
            $('a').each((i, elem) => {
                if (products.length >= 15) return false;
                
                const $elem = $(elem);
                const href = $elem.attr('href');
                const text = $elem.text().trim();
                
                if (!href || !text || text.length < 10) return;
                
                const textLower = text.toLowerCase();
                const matchesKeyword = keywords.some(keyword => textLower.includes(keyword));
                
                if (!matchesKeyword) return;
                
                // Verifică dacă are preț în apropiere (semn că e produs, nu categorie)
                const $parent = $elem.parent();
                const nearbyText = $parent.text();
                const hasPrice = /[\d.,]+\s*(?:lei|ron|€|eur)/i.test(nearbyText);
                
                // Sau verifică dacă textul conține numere/brand (semn de produs specific)
                const hasSpecificInfo = /\d/.test(text) || 
                    /(yamaha|fender|gibson|ibanez|epiphone|cort|squier|martin|taylor|model|set|pachet)/i.test(text);
                
                if (hasPrice || hasSpecificInfo) {
                    let fullUrl = href;
                    if (!href.startsWith('http')) {
                        try {
                            const baseUrl = new URL(pageUrl);
                            fullUrl = href.startsWith('/') 
                                ? baseUrl.origin + href 
                                : baseUrl.origin + '/' + href;
                        } catch (e) {
                            fullUrl = pageUrl;
                        }
                    }
                    
                    let price = 'N/A';
                    const priceMatch = nearbyText.match(/[\d.,]+\s*(?:lei|ron|€|eur)/i);
                    if (priceMatch) {
                        price = priceMatch[0];
                    }
                    
                    const isDuplicate = products.some(p => p.Link === fullUrl);
                    if (!isDuplicate) {
                        products.push({
                            Nume: text,
                            Pret: price,
                            Link: fullUrl
                        });
                    }
                }
            });
        }
        
    } catch (error) {
        // Ignoră erorile pentru pagini individuale
    }
    
    return products;
}

/**
 * Caută produse pe un site web folosind web scraping
 * @param {string} websiteUrl - URL-ul site-ului
 * @param {string} searchQuery - Categoria/descrierea pentru căutare
 * @returns {Promise<Array<{Nume: string, Pret: string, Link: string}>>} Lista de produse găsite
 */
async function searchProductsOnWebsite(websiteUrl, searchQuery) {
    const products = [];
    const seenUrls = new Set();
    
    try {
        // Normalizează URL-ul
        let url = websiteUrl.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        console.log(`   🔍 Căutare produse pe ${url}...`);
        
        // Face request la pagina principală
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        if (!response.ok) {
            console.log(`   ⚠️  Nu s-a putut accesa site-ul (HTTP ${response.status})`);
            return products;
        }
        
        const html = await response.text();
        const $ = cheerio.load(html);
        const keywords = searchQuery.toLowerCase().split(/\s+/);
        
        // Strategia 1: Caută direct produse pe pagina principală
        const mainPageProducts = await extractProductsFromPage(url, searchQuery);
        mainPageProducts.forEach(p => {
            if (!seenUrls.has(p.Link)) {
                products.push(p);
                seenUrls.add(p.Link);
            }
        });
        
        // Strategia 2: Caută link-uri către categorii/produse și navighează în ele
        const categoryLinks = [];
        $('a').each((i, elem) => {
            if (categoryLinks.length >= 5) return false; // Limitează la 5 categorii
            
            const $elem = $(elem);
            const href = $elem.attr('href');
            const text = $elem.text().trim();
            
            if (!href || !text) return;
            
            const hrefLower = href.toLowerCase();
            const textLower = text.toLowerCase();
            
            const matchesKeyword = keywords.some(keyword => 
                hrefLower.includes(keyword) || textLower.includes(keyword)
            );
            
            if (matchesKeyword && text.length > 3) {
                let fullUrl = href;
                if (href.startsWith('/')) {
                    try {
                        const baseUrl = new URL(url);
                        fullUrl = baseUrl.origin + href;
                    } catch (e) {
                        fullUrl = url + href;
                    }
                } else if (!href.startsWith('http')) {
                    try {
                        const baseUrl = new URL(url);
                        fullUrl = baseUrl.origin + '/' + href;
                    } catch (e) {
                        fullUrl = url + '/' + href;
                    }
                }
                
                // Verifică dacă e categorie sau produs
                if (isCategoryLink(text, href)) {
                    // E categorie - adaugă la listă pentru a naviga mai târziu
                    if (!categoryLinks.includes(fullUrl) && fullUrl.startsWith('http')) {
                        categoryLinks.push(fullUrl);
                    }
                } else {
                    // Pare a fi produs - extrage direct
                    if (!seenUrls.has(fullUrl)) {
                        let price = 'N/A';
                        const $parent = $elem.parent();
                        const priceMatch = $parent.text().match(/[\d.,]+\s*(?:lei|ron|€|eur)/i);
                        if (priceMatch) {
                            price = priceMatch[0];
                        }
                        
                        products.push({
                            Nume: text,
                            Pret: price,
                            Link: fullUrl
                        });
                        seenUrls.add(fullUrl);
                    }
                }
            }
        });
        
        // Strategia 3: Navighează în paginile de categorii pentru a găsi produse
        for (const categoryUrl of categoryLinks.slice(0, 3)) { // Max 3 categorii
            if (products.length >= 20) break; // Limitează totalul
            
            console.log(`   📂 Navigare în categorie: ${categoryUrl}`);
            const categoryProducts = await extractProductsFromPage(categoryUrl, searchQuery);
            
            categoryProducts.forEach(p => {
                if (!seenUrls.has(p.Link) && products.length < 20) {
                    products.push(p);
                    seenUrls.add(p.Link);
                }
            });
            
            // Pauză între request-uri
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Filtrează duplicatele și păstrează doar produsele reale (nu categorii)
        const filteredProducts = products.filter(p => {
            // Exclude link-uri care sunt clar categorii
            const isCategory = isCategoryLink(p.Nume, p.Link);
            return !isCategory && p.Nume.length > 5;
        });
        
        console.log(`   ✅ Găsite ${filteredProducts.length} produse (din ${products.length} total)`);
        return filteredProducts.slice(0, 15); // Limitează la 15 produse per site
        
    } catch (error) {
        console.log(`   ⚠️  Eroare la căutarea produselor: ${error.message}`);
    }
    
    return products;
}

/**
 * Citește businesses.json și returnează toate site-urile (nu doar primele 3)
 * @returns {Promise<Array<{Denumire: string, Website: string}>>} Toate business-urile cu website
 */
async function getAllWebsites() {
    try {
        const filepath = path.join(__dirname, 'businesses.json');
        const data = await fs.readFile(filepath, 'utf8');
        const businesses = JSON.parse(data);
        
        // Filtrează doar cele cu website
        const businessesWithWebsite = businesses
            .filter(b => b.Website && b.Website.trim() !== '');
        
        return businessesWithWebsite;
    } catch (error) {
        console.error('❌ Eroare la citirea businesses.json:', error.message);
        return [];
    }
}

/**
 * Caută produse pe primele 3 site-uri din businesses.json
 * Dacă un site nu are prețuri, trece la următorul
 * @param {string} searchQuery - Categoria/descrierea pentru căutare
 * @returns {Promise<Array>} Lista de produse găsite
 */
async function searchProductsOnTopSites(searchQuery) {
    console.log('\n' + '='.repeat(60));
    console.log('🛍️  CĂUTARE PRODUSE PE SITE-URI');
    console.log('='.repeat(60));
    console.log(`📂 Căutare: ${searchQuery}`);
    console.log('='.repeat(60));
    console.log('');
    
    const allWebsites = await getAllWebsites();
    
    if (allWebsites.length === 0) {
        console.log('⚠️  Nu s-au găsit site-uri în businesses.json');
        return [];
    }
    
    // Verifică toate site-urile disponibile, maxim 50
    const maxSitesToCheck = Math.min(50, allWebsites.length); // Verifică maxim 50 site-uri
    const sitesToCheck = allWebsites.slice(0, maxSitesToCheck);
    
    console.log(`📋 Site-uri disponibile: ${allWebsites.length}`);
    console.log(`📋 Site-uri de verificat: ${sitesToCheck.length}`);
    console.log('');
    
    const allProducts = [];
    let sitesWithPrices = 0;
    const minSitesWithPrices = 3; // Vrem cel puțin 3 site-uri cu prețuri
    
    for (let i = 0; i < sitesToCheck.length; i++) {
        const business = sitesToCheck[i];
        console.log(`\n[${i + 1}/${sitesToCheck.length}] ${business.Denumire}`);
        
        const products = await searchProductsOnWebsite(business.Website, searchQuery);
        
        if (products.length === 0) {
            console.log(`   ⚠️  Nu s-au găsit produse pe acest site, trec la următorul...`);
            // Pauză scurtă înainte de următorul site
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
        }
        
        // Verifică dacă există produse cu prețuri
        const productsWithPrice = products.filter(p => 
            p.Pret && p.Pret !== 'N/A' && p.Pret.trim() !== ''
        );
        
        if (productsWithPrice.length === 0) {
            console.log(`   ⚠️  Nu s-au găsit prețuri pe acest site (${products.length} produse fără preț), trec la următorul...`);
            // Pauză scurtă înainte de următorul site
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
        }
        
        // Site-ul are produse cu prețuri - le adaugă (doar cele cu prețuri)
        console.log(`   ✅ Găsite ${productsWithPrice.length} produse cu prețuri (din ${products.length} total)`);
        sitesWithPrices++;
        
        // Adaugă informații despre site doar la produsele cu prețuri
        productsWithPrice.forEach(product => {
            allProducts.push({
                ...product,
                Site: business.Denumire,
                Site_URL: business.Website
            });
        });
        
        // Dacă am găsit suficiente site-uri cu prețuri, putem opri
        if (sitesWithPrices >= minSitesWithPrices && allProducts.length >= 20) {
            console.log(`\n✅ Găsite suficiente produse cu prețuri de pe ${sitesWithPrices} site-uri`);
            break;
        }
        
        // Pauză între request-uri pentru a evita rate limiting
        if (i < sitesToCheck.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    console.log(`\n📊 Rezumat: ${sitesWithPrices} site-uri cu prețuri, ${allProducts.length} produse totale`);
    
    return allProducts;
}

/**
 * Salvează produsele în top-products.json (doar cele cu prețuri)
 * Șterge complet conținutul vechi și scrie doar noile produse
 * @param {Array} products - Lista de produse
 */
async function saveProducts(products) {
    const filepath = path.join(__dirname, 'site logica', 'top-products.json');
    
    // Șterge conținutul vechi - scrie un array gol dacă nu sunt produse
    let productsToSave = [];
    
    if (products && products.length > 0) {
        // Filtrează doar produsele cu prețuri valide
        productsToSave = products.filter(p => 
            p.Pret && 
            p.Pret !== 'N/A' && 
            p.Pret.trim() !== '' &&
            /\d/.test(p.Pret) // Trebuie să conțină cel puțin o cifră
        );
    }
    
    // Șterge complet fișierul vechi și scrie doar noile produse (sau array gol)
    await fs.writeFile(filepath, JSON.stringify(productsToSave, null, 2), 'utf8');
    console.log(`\n💾 Produsele au fost salvate în: site logica/top-products.json (${productsToSave.length} produse cu prețuri din ${products ? products.length : 0} total)`);
    console.log(`🗑️  Conținutul vechi a fost șters complet.`);
}

/**
 * Funcția principală
 */
async function main() {
    // Exemplu de utilizare
    const userCategory = process.argv[2] || 'restaurant'; // Primește categoria din command line
    const userLocation = {
        lat: 44.4897,  // București (poți schimba)
        lng: 26.1186
    };
    const searchRadius = 10000; // 10km

    console.log('='.repeat(60));
    console.log('🔎 CĂUTARE BUSINESS-URI');
    console.log('='.repeat(60));
    console.log(`📂 Categorie: ${userCategory}`);
    console.log(`📍 Locație: ${userLocation.lat}, ${userLocation.lng}`);
    console.log(`📏 Rază: ${searchRadius / 1000}km`);
    console.log(`🎯 Rezultate max: ${MAX_RESULTS}`);
    console.log('='.repeat(60));
    console.log('');

    try {
        const results = await searchBusinesses(userCategory, userLocation, searchRadius);

        console.log('');
        console.log('='.repeat(60));
        console.log(`✅ REZULTATE (${results.length} business-uri găsite):`);
        console.log('='.repeat(60));

        results.forEach((business, index) => {
            console.log(`\n${index + 1}. ${business.name}`);
            console.log(`   📍 ${business.address}`);
            if (business.rating) {
                console.log(`   ⭐ ${business.rating}/5.0 (${business.totalRatings} review-uri)`);
            }
            if (business.isOpen !== null) {
                console.log(`   ${business.isOpen ? '🟢 Deschis' : '🔴 Închis'}`);
            }
            if (business.website) {
                console.log(`   🌐 Website: ${business.website}`);
            } else {
                console.log(`   🌐 Website: Nu disponibil`);
            }
            console.log(`   🆔 Place ID: ${business.placeId}`);
        });

        console.log('\n' + '='.repeat(60));
        console.log(`📊 Total: ${results.length} business-uri`);
        console.log('='.repeat(60));

        // Salvează rezultatele local într-un fișier JSON (suprascrie datele vechi)
        if (results.length > 0) {
            await saveBusinessesLocal(results);
            
            // Caută produse pe primele 3 site-uri
            const products = await searchProductsOnTopSites(userCategory);
            
            // Șterge conținutul vechi și scrie noile produse (sau array gol dacă nu sunt produse)
            await saveProducts(products);
            
            if (products.length === 0) {
                console.log('\n⚠️  Nu s-au găsit produse pe site-urile selectate');
            }
        } else {
            // Dacă nu s-au găsit business-uri, șterge totuși produsele vechi
            console.log('\n⚠️  Nu s-au găsit business-uri, se șterg produsele vechi din top-products.json');
            await saveProducts([]);
        }

    } catch (error) {
        console.error('\n❌ Eroare:', error.message);
        process.exit(1);
    }
}

// Rulează dacă este fișierul principal
if (require.main === module) {
    main();
}

// Export pentru utilizare în alte module
module.exports = {
    searchBusinesses,
    getPlaceType,
    isLodging
};

