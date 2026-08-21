const env = require('../config/environment');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Reseñas de Google para la home (Places API New).
 *
 * La llave de Google NO puede viajar al navegador: una key de Places sin
 * restricciones que quede en el bundle la puede usar cualquiera y la factura
 * llega a nombre de la mueblería. Por eso el frontend pega aquí y este
 * endpoint es el único que habla con Google.
 *
 * Google cobra por consulta, así que el resultado se guarda en memoria. Es
 * caché de proceso, no compartida entre instancias: con un solo contenedor
 * (el despliegue actual) alcanza, y si algún día hay varios, lo peor que
 * pasa es que cada uno pague su propia consulta cada 6 horas.
 */

/** Google permite cachear como máximo 30 días; 6 horas es de sobra y barato. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** El Place ID sí se puede guardar indefinidamente según los términos de Google. */
let cachedPlaceId = env.google.placeId || null;
let cache = { at: 0, payload: null };

const EMPTY = { rating: null, total: 0, url: null, reviews: [] };

/**
 * Resuelve el Place ID a partir del nombre del negocio. Existe para que
 * baste con configurar GOOGLE_PLACES_API_KEY: pedirle al usuario que además
 * encuentre el Place ID en la consola de Google es un paso que se atora.
 */
async function resolvePlaceId() {
  if (cachedPlaceId) return cachedPlaceId;

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.google.apiKey,
      'X-Goog-FieldMask': 'places.id',
    },
    body: JSON.stringify({ textQuery: env.google.placeQuery, languageCode: 'es' }),
  });

  if (!res.ok) {
    throw new Error(`Places searchText respondió ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  const id = body.places?.[0]?.id;
  if (!id) {
    throw new Error(`Google no encontró ningún lugar para "${env.google.placeQuery}"`);
  }

  cachedPlaceId = id;
  return id;
}

async function fetchFromGoogle() {
  const placeId = await resolvePlaceId();

  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es`,
    {
      headers: {
        'X-Goog-Api-Key': env.google.apiKey,
        'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri,reviews',
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Places details respondió ${res.status}: ${await res.text()}`);
  }

  const place = await res.json();

  return {
    rating: place.rating ?? null,
    total: place.userRatingCount ?? 0,
    url: place.googleMapsUri ?? null,
    // Google devuelve un máximo de 5. Se aplanan a lo que la home necesita
    // para no filtrar al navegador campos que no se usan.
    reviews: (place.reviews || [])
      .filter((r) => r.text?.text)
      .map((r) => ({
        author: r.authorAttribution?.displayName || 'Cliente de Google',
        photo: r.authorAttribution?.photoUri || null,
        // Los términos de Google piden que el nombre del autor enlace a su
        // perfil cuando se muestran sus reseñas.
        profileUrl: r.authorAttribution?.uri || null,
        rating: r.rating ?? null,
        text: r.text.text,
        when: r.relativePublishTimeDescription || null,
      })),
  };
}

const reviewsController = {
  // GET /api/reviews/google — público, sin autenticar (lo consume la home).
  google: asyncHandler(async (req, res) => {
    if (!env.google.apiKey) {
      // Sin llave configurada no es un error: el bloque de reseñas
      // simplemente no se pinta hasta que se configure.
      return res.json({ data: EMPTY });
    }

    const fresh = Date.now() - cache.at < CACHE_TTL_MS;
    if (fresh && cache.payload) {
      return res.json({ data: cache.payload });
    }

    try {
      const payload = await fetchFromGoogle();
      cache = { at: Date.now(), payload };
      return res.json({ data: payload });
    } catch (err) {
      // Que Google falle no puede tumbar la portada. Si hay algo cacheado
      // (aunque esté vencido) se sirve eso; si no, se responde vacío.
      console.error('[reviews] Google Places falló:', err.message);
      return res.json({ data: cache.payload || EMPTY });
    }
  }),
};

module.exports = reviewsController;
