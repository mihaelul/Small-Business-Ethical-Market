# Business Finder - Căutare Business-uri cu Google Maps API

Sistem simplu pentru căutarea business-urilor folosind Google Maps Places API.

## 🚀 Instalare

1. Instalează dependențele:
```bash
npm install
```

2. Configurează conexiunea:
   - Creează un fișier `.env` în root-ul proiectului
   - Adaugă configurația:

   **Pentru Google Maps API:**
   ```
   GOOGLE_MAPS_API_KEY=your_api_key_here
   ```

   **Pentru SQL Server - Windows Authentication (recomandat):**
   ```
   DB_SERVER=localhost
   DB_NAME=mockup
   DB_USE_WINDOWS_AUTH=true
   DB_ENCRYPT=false
   ```

   **Pentru SQL Server - SQL Authentication:**
   ```
   DB_SERVER=localhost
   DB_NAME=mockup
   DB_USER=sa
   DB_PASSWORD=your_password
   DB_USE_WINDOWS_AUTH=false
   DB_ENCRYPT=false
   ```

## 📖 Utilizare

### Din command line:
```bash
node search.js "restaurant"
node search.js "carti"
node search.js "haine"
node search.js "cafe"
```

### Programatic:
```javascript
const { searchBusinesses } = require('./search');

const results = await searchBusinesses(
    'restaurant',           // Categoria
    { lat: 44.4897, lng: 26.1186 },  // Locația
    10000                   // Raza în metri (opțional)
);

console.log(results);
```

## 📋 Categorii Suportate

- **Cărți**: `carti`, `bookstore`, `librarie`, `books`
- **Mâncare**: `mancare`, `restaurant`, `food`, `pizza`, `pizzerie`
- **Cafenele**: `cafe`, `cafenea`, `coffee`
- **Haine**: `haine`, `clothing`, `fashion`, `imbracaminte`
- **Altele**: `farmacie`, `supermarket`, `magazin`

Sau poți folosi orice categorie - sistemul va căuta după keyword.

## ⚙️ Configurare

Poți modifica în `search.js`:
- `MAX_RESULTS` - Numărul maxim de rezultate (default: 50)
- Locația default
- Raza de căutare

## 📝 Note

- Google Maps API returnează max 20 rezultate per request
- Sistemul face automat paginare pentru a obține până la 50 de rezultate
- Ai nevoie de un API key valid cu Places API activat

