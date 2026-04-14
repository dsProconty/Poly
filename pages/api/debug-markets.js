const CLOB_BASE = 'https://clob.polymarket.com';

/**
 * Endpoint de debug — muestra qué devuelve la API de Polymarket
 * antes de cualquier filtro
 * Acceder en: /api/debug-markets
 */
export default async function handler(req, res) {
  try {
    const res1 = await fetch(`https://gamma-api.polymarket.com/markets?active=true&closed=false&tag_slug=sports&limit=20`);
    const markets = await res1.json();

    const minVolume = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
    const requireVs = process.env.REQUIRE_VS_FORMAT !== 'false';

    // Mostrar todos los campos del primer mercado para entender la estructura
    const primerMercado = markets[0] || {};

    return res.json({
      total_raw: markets.length,
      filtros_activos: { minVolume, requireVs },
      campos_disponibles: Object.keys(primerMercado),
      primeros_3_completos: markets.slice(0, 3),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
