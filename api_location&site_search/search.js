require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

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
    const uniqueBusinesses = simplifiedBusinesses.filter(business => {
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

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `businesses_${timestamp}.json`;
    const filepath = path.join(__dirname, filename);

    await fs.writeFile(filepath, JSON.stringify(uniqueBusinesses, null, 2), 'utf8');
    console.log(`💾 Datele au fost salvate local în: ${filename} (${uniqueBusinesses.length} business-uri unice)`);
    
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

        // Salvează rezultatele local într-un fișier JSON
        let savedFilePath = null;
        if (results.length > 0) {
            savedFilePath = await saveBusinessesLocal(results);
        }

    } catch (error) {
        console.error('\n❌ Eroare:', error.message);
        process.exit(1);
    } finally {
        // Șterge fișierul local după terminarea procesului
        if (savedFilePath) {
            console.log('\n🧹 Curățare fișiere temporare...');
            await deleteLocalFile(savedFilePath);
        }
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

