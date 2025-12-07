require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyCgsbGSK3h6skaM1cAinmyUAulC2rFy5wo';
const MAX_RESULTS = 50; 


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
 * checks if a place is a lodging
 * @param {Array<string>} types 
 * @returns {boolean} 
 */
function isLodging(types) {
    if (!types || !Array.isArray(types)) {
        return false;
    }
    return types.some(type => LODGING_TYPES.includes(type));
}

/**
 * fetches the website of a business
 * @param {string} placeId - Place business ID
 * @returns {Promise<string|null>} 
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
        return null;
    }
}

/**
 * searches businesses using Google Maps Places API
 * @param {string} category - Category to search (ex: "bookstore", "restaurant", "clothing store")
 * @param {object} location - Location coordinates { lat: number, lng: number }
 * @param {number} radius - Search radius in meters (default: 5000m = 5km)
 * @returns {Promise<Array>} 
 */
async function searchBusinesses(category, location, radius = 5000) {
    const baseUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
    const allResults = [];
    let nextPageToken = null;
    let requestCount = 0;
    const maxRequests = 3; 

    try {
        do {
            // builds parameters for request
            const params = new URLSearchParams({
                key: API_KEY,
                location: `${location.lat},${location.lng}`,
                radius: radius.toString(),
                keyword: category,
                type: getPlaceType(category) // tries to map the category to a Google Maps type
            });

            // if we have a next_page_token, add it for pagination
            if (nextPageToken) {
                params.delete('location');
                params.delete('radius');
                params.delete('keyword');
                params.delete('type');
                params.set('pagetoken', nextPageToken);
                // wait a bit - Google needs time to generate the token
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            const url = `${baseUrl}?${params.toString()}`;
            console.log(`🔍 Request ${requestCount + 1}: Căutare "${category}"...`);

            // fetches from API
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // checks for errors
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

            // adds results to list (excluding lodgings)
            if (data.results && data.results.length > 0) {
                // filters out lodgings
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

            // checks if there are more pages
            nextPageToken = data.next_page_token || null;
            requestCount++;

            // stops if we reached the desired limit 
            if (allResults.length >= MAX_RESULTS || !nextPageToken || requestCount >= maxRequests) {
                break;
            }

        } while (nextPageToken && allResults.length < MAX_RESULTS);

        // limits to MAX_RESULTS
        const limitedResults = allResults.slice(0, MAX_RESULTS);

        // fetches the website for each business
        console.log('\n🌐 Obținere website-uri pentru business-uri...');
        for (let i = 0; i < limitedResults.length; i++) {
            const business = limitedResults[i];
            const website = await getPlaceWebsite(business.placeId);
            business.website = website;
            
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
 * maps the category given by the user to a Google Places API type
 * @param {string} category - Category in Romanian or English
 * @returns {string} Google Places API type
 */
function getPlaceType(category) {
    const categoryMap = {
        // Books
        'carti': 'book_store',
        'bookstore': 'book_store',
        'librarie': 'book_store',
        'books': 'book_store',
        
        // Food
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
        
        // Clothes
        'haine': 'clothing_store',
        'clothing': 'clothing_store',
        'fashion': 'clothing_store',
        'imbracaminte': 'clothing_store',
        
        // Other
        'farmacie': 'pharmacy',
        'pharmacy': 'pharmacy',
        'supermarket': 'supermarket',
        'magazin': 'store',
        'shop': 'store'
    };

    const normalizedCategory = category.toLowerCase().trim();
    return categoryMap[normalizedCategory] || null; // returns null if not found, will only use keyword
}

/**
 * save local businesses in a JSON file
 * eliminates duplicates websites (saves only the first occurrence)
 * overwrites the existing file with new data (deletes old data)
 * @param {Array<object>} businesses - List of businesses
 * @returns {Promise<string>} Path to the saved file
 */
async function saveBusinessesLocal(businesses) {
   
    const simplifiedBusinesses = businesses.map(business => ({
        Denumire: business.name,
        Adresa: business.address || null,
        Rating: business.rating || 0,
        Nr_Reviews: business.totalRatings || 0,
        Website: business.website || null
    }));

    // deleteslocations without websites and duplicates 
    const seenWebsites = new Set();
    let uniqueBusinesses = simplifiedBusinesses.filter(business => {

        if (!business.Website) {
            return false;
        }
        
        const normalizedWebsite = business.Website.toLowerCase().replace(/\/$/, '');

        if (seenWebsites.has(normalizedWebsite)) {
            return false;
        }

        seenWebsites.add(normalizedWebsite);
        return true;
    });

    const duplicatesRemoved = simplifiedBusinesses.length - uniqueBusinesses.length;
    if (duplicatesRemoved > 0) {
        console.log(`🔍 Eliminate ${duplicatesRemoved} duplicate după website`);
    }


    const businessesWithReviews = uniqueBusinesses.filter(business => {
        return business.Nr_Reviews && business.Nr_Reviews > 0;
    });

    const noReviewsRemoved = uniqueBusinesses.length - businessesWithReviews.length;
    if (noReviewsRemoved > 0) {
        console.log(`🔍 Eliminate ${noReviewsRemoved} locații fără review-uri`);
    }

    // uses a formula that combines the rating and the number of reviews
    // with a higher weight for rating, but penalizes many reviews
    businessesWithReviews.sort((a, b) => {
        const reviewsA = a.Nr_Reviews || 0;
        const reviewsB = b.Nr_Reviews || 0;
        const ratingA = a.Rating || 0;
        const ratingB = b.Rating || 0;
        
        // threshold for the rating difference (if it's less than this, consider the ratings similar)
        const ratingThreshold = 0.2;
        const ratingDiff = Math.abs(ratingA - ratingB);
        
        // if the rating difference is significant (>= threshold), prioritize the rating
        if (ratingDiff >= ratingThreshold) {
            return ratingB - ratingA; // Descendent după rating
        }
        
        // if the ratings are similar (difference < threshold), prefer the one with fewer reviews
        // but still consider the rating (if one is slightly better, but has many reviews,
        // prefer the one with a slightly lower rating but significantly fewer reviews)
        
        // calculates a combined score: rating * 1000 - reviews * 2
        // thus the rating has a high weight, but many reviews penalize more
        const scoreA = ratingA * 1000 - reviewsA * 2;
        const scoreB = ratingB * 1000 - reviewsB * 2;
            
            // sorts descending by score (higher score = higher)
        return scoreB - scoreA;
    });

    // uses a single file that is updated at each search
    const filename = 'businesses.json';
    const filepath = path.join(__dirname, filename);

    await fs.writeFile(filepath, JSON.stringify(businessesWithReviews, null, 2), 'utf8');
    console.log(`Datele au fost actualizate si sortate în: ${filename} (${businessesWithReviews.length} business-uri unice cu review-uri)`);
    console.log(`Sortare: prioritizeaza Rating (dacă diferenta >= 0.2), altfel Score = Rating * 1000 - Reviews * 2`);
    
    return filepath;
}

/**

 * @param {string} filepath - Calea către fișier
 */
async function deleteLocalFile(filepath) {
    try {
        await fs.unlink(filepath);
        console.log(`🗑️  Fisierul ${path.basename(filepath)} a fost sters`);
    } catch (error) {
        console.warn(`⚠️  Nu s-a putut sterge fisierul: ${error.message}`);
    }
}


/**

 * @param {string} text 
 * @param {string} href 
 * @returns {boolean}
 */
function isCategoryLink(text, href) {
    const textLower = text.toLowerCase();
    const hrefLower = href.toLowerCase();
    
    // indicators that it's a category:
    // - short and generic text (ex: "Chitara electrica", "Chitara acustica")
    // - does not contain brand or model specific names

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
            
            // searches for products using common selectors for e-commerce
        const productSelectors = [
            '.product', '.produs', '.product-item', '.product-card',
            '[class*="product"]', '[class*="produs"]', '[class*="item"]',
            'article', '.grid-item', '.shop-item'
        ];
        
        // Step 1: searches for elements with product classes
        productSelectors.forEach(selector => {
            $(selector).each((i, elem) => {
                if (products.length >= 15) return false;
                
                const $elem = $(elem);
                const $link = $elem.find('a').first();
                const href = $link.attr('href');
                const text = $link.text().trim() || $elem.find('h1, h2, h3, h4, .title, .name').first().text().trim();
                
                if (!text || text.length < 10) return;
                
               
                const textLower = text.toLowerCase();
                const matchesKeyword = keywords.some(keyword => textLower.includes(keyword));
                
                if (!matchesKeyword) return;
                
                // searches for price
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
                
                // builds the full URL
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
        
        // Step 2: if we don't find products, search for links with prices
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
                
        
                const $parent = $elem.parent();
                const nearbyText = $parent.text();
                const hasPrice = /[\d.,]+\s*(?:lei|ron|€|eur)/i.test(nearbyText);
                
                
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
        // ignores errors for individual pages
    }
    
    return products;
}

/**
 * searches for products on a website using web scraping
 * @param {string} websiteUrl - URL-ul site-ului
 * @param {string} searchQuery - Categoria/descrierea pentru căutare
 * @returns {Promise<Array<{Nume: string, Pret: string, Link: string}>>} Lista de produse găsite
 */
async function searchProductsOnWebsite(websiteUrl, searchQuery) {
    const products = [];
    const seenUrls = new Set();
    
    try {
     
        let url = websiteUrl.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        console.log(`   🔍 Căutare produse pe ${url}...`);
        

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
        
        // Step 1: searches for products on the main page
        const mainPageProducts = await extractProductsFromPage(url, searchQuery);
        mainPageProducts.forEach(p => {
            if (!seenUrls.has(p.Link)) {
                products.push(p);
                seenUrls.add(p.Link);
            }
        });
        
        // Step 2: searches for links to categories/products and navigates in them
        const categoryLinks = [];
        $('a').each((i, elem) => {
            if (categoryLinks.length >= 5) return false; // limits to 5 categories
            
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
                
                // checks if it's a category or a product
                if (isCategoryLink(text, href)) {
                    // it's a category - add to list to navigate later
                    if (!categoryLinks.includes(fullUrl) && fullUrl.startsWith('http')) {
                        categoryLinks.push(fullUrl);
                    }
                } else {
                    // it's a product - extract directly
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
        
        // Step 3: navigate in category pages to find products
        for (const categoryUrl of categoryLinks.slice(0, 3)) { 
            if (products.length >= 20) break; // Limitează totalul
            
            console.log(`Navigare în categorie: ${categoryUrl}`);
            const categoryProducts = await extractProductsFromPage(categoryUrl, searchQuery);
            
            categoryProducts.forEach(p => {
                if (!seenUrls.has(p.Link) && products.length < 20) {
                    products.push(p);
                    seenUrls.add(p.Link);
                }
            });
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // filters duplicates and keeps only the real products (not categories)
        const filteredProducts = products.filter(p => {
            const isCategory = isCategoryLink(p.Nume, p.Link);
            return !isCategory && p.Nume.length > 5;
        });
        
        console.log(` Găsite ${filteredProducts.length} produse (din ${products.length} total)`);
        return filteredProducts.slice(0, 15); 
        
    } catch (error) {
        console.log(` Eroare la căutarea produselor: ${error.message}`);
    }
    
    return products;
}

/**
 * reads businesses.json and returns all websites (not just the first 3)
 * @returns {Promise<Array<{Denumire: string, Website: string}>>} 
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
        console.error('Eroare la citirea businesses.json:', error.message);
        return [];
    }
}

/**
 * searches for products on the first 3 websites in businesses.json
 * if a website doesn't have prices, it goes to the next one
 * @param {string} searchQuery - Categoria/descrierea pentru căutare
 * @returns {Promise<Array>} Lista de produse găsite
 */
async function searchProductsOnTopSites(searchQuery) {
    console.log('\n' + '='.repeat(60));
    console.log(' CĂUTARE PRODUSE PE SITE-URI');
    console.log('='.repeat(60));
    console.log(`Căutare: ${searchQuery}`);
    console.log('='.repeat(60));
    console.log('');
    
    const allWebsites = await getAllWebsites();
    
    if (allWebsites.length === 0) {
        console.log(' Nu s-au gasit site-uri in businesses.json');
        return [];
    }
    
    // checks all available websites, maximum 50
    const maxSitesToCheck = Math.min(50, allWebsites.length); 
    const sitesToCheck = allWebsites.slice(0, maxSitesToCheck);
    
    console.log(`Site-uri disponibile: ${allWebsites.length}`);
    console.log(`Site-uri de verificat: ${sitesToCheck.length}`);
    console.log('');
    
    const allProducts = [];
    let sitesWithPrices = 0;
    const minSitesWithPrices = 3; 
    
    for (let i = 0; i < sitesToCheck.length; i++) {
        const business = sitesToCheck[i];
        console.log(`\n[${i + 1}/${sitesToCheck.length}] ${business.Denumire}`);
        
        const products = await searchProductsOnWebsite(business.Website, searchQuery);
        
        if (products.length === 0) {
            console.log(` Nu s-au gasit produse pe acest site, trec la urmatorul...`);
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
        }
        
    
        const productsWithPrice = products.filter(p => 
            p.Pret && p.Pret !== 'N/A' && p.Pret.trim() !== ''
        );
        
        if (productsWithPrice.length === 0) {
            console.log(`Nu s-au gasit preturi pe acest site (${products.length} produse fara pret), trec la urmatorul...`);
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
        }
        
 
        console.log(`Gasite ${productsWithPrice.length} produse cu preturi (din ${products.length} total)`);
        sitesWithPrices++;
        
     
        productsWithPrice.forEach(product => {
            allProducts.push({
                ...product,
                Site: business.Denumire,
                Site_URL: business.Website
            });
        });
        
        // if we have found enough websites with prices, we can stop
        if (sitesWithPrices >= minSitesWithPrices && allProducts.length >= 20) {
            console.log(`\n Gasite suficiente produse cu preturi de pe ${sitesWithPrices} site-uri`);
            break;
        }
        
        // pause between requests to avoid rate limiting
        if (i < sitesToCheck.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    console.log(`\n Rezumat: ${sitesWithPrices} site-uri cu preturi, ${allProducts.length} produse totale`);
    
    return allProducts;
}

/**
 * saves the products in top-products.json (only the ones with prices)
 * deletes the old content and writes only the new products
 * @param {Array} products - List of products
 */
async function saveProducts(products) {
    const filepath = path.join(__dirname, 'site logica', 'top-products.json');
    
    // deletes the old content - writes an empty array if there are no products
    let productsToSave = [];
    
    if (products && products.length > 0) {
        // filters only the products with valid prices
        productsToSave = products.filter(p => 
            p.Pret && 
            p.Pret !== 'N/A' && 
            p.Pret.trim() !== '' &&
            /\d/.test(p.Pret) 
        );
    }
    
    // deletes the old content - writes an empty array if there are no products
    await fs.writeFile(filepath, JSON.stringify(productsToSave, null, 2), 'utf8');
    console.log(`\n Produsele au fost salvate în: site logica/top-products.json (${productsToSave.length} produse cu preturi din ${products ? products.length : 0} total)`);
    console.log(` Continutul vechi a fost sters complet.`);
}

/**
 * the main function
 */
async function main() {
    // Exemplu de utilizare
    const userCategory = process.argv[2] || 'restaurant'; 
    const userLocation = {
        lat: 44.4897,  // Bucuresti
        lng: 26.1186
    };
    const searchRadius = 10000; // 10km

    console.log('='.repeat(60));
    console.log('CAUTARE BUSINESS-URI');
    console.log('='.repeat(60));
    console.log(`Categorie: ${userCategory}`);
    console.log(`Locatie: ${userLocation.lat}, ${userLocation.lng}`);
    console.log(`Raza: ${searchRadius / 1000}km`);
    console.log(`Rezultate max: ${MAX_RESULTS}`);
    console.log('='.repeat(60));
    console.log('');

    try {
        const results = await searchBusinesses(userCategory, userLocation, searchRadius);

        console.log('');
        console.log('='.repeat(60));
        console.log(`REZULTATE (${results.length} business-uri gasite):`);
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

      
        if (results.length > 0) {
            await saveBusinessesLocal(results);
            
            // searches for products on the first 3 websites
            const products = await searchProductsOnTopSites(userCategory);
            
            // deletes the old content and writes only the new products
            await saveProducts(products);
            
            if (products.length === 0) {
                console.log('\n  Nu s-au găsit produse pe site-urile selectate');
            }
        } else {
            // if no businesses are found, delete the old products
            console.log('\n Nu s-au găsit business-uri, se șterg produsele vechi din top-products.json');
            await saveProducts([]);
        }

    } catch (error) {
        console.error('\n Eroare:', error.message);
        process.exit(1);
    }
}

// runs if this is the main file
if (require.main === module) {
    main();
}

// Export pentru utilizare în alte module
module.exports = {
    searchBusinesses,
    getPlaceType,
    isLodging
};

