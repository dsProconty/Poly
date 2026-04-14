const CLOB_BASE = 'https://clob.polymarket.com';

/**
 * Endpoint de debug — muestra qué devuelve la API de Polymarket
 * antes de cualquier filtro
 * Acceder en: /api/debug-markets
 */
export default async function handler(req, res) {
  try {
    const res1 = await fetch(`${CLOB_BASE}/markets?active=true&tag_id=12&limit=20`);
    const data = await res1.json();
    const markets = data.data || [];

    const minVolume = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
    const requireVs = process.env.REQUIRE_VS_FORMAT !== 'false';

    return res.json({
      total_raw: markets.length,
      filtros_activos: { minVolume, requireVs },
      pasan_filtro: markets.filter(m =>
        parseFloat(m.volume) > minVolume &&
        (requireVs ? m.question?.includes(' vs ') : true)
      ).length,
      mercados_raw: markets.map(m => ({
        question: m.question,
        volume: parseFloat(m.volume) || 0,
        active: m.active,
        resolved: m.resolved,
        pasa_filtro: (parseFloat(m.volume) || 0) > minVolume && (requireVs ? m.question?.includes(' vs ') : true),
      })).sort((a, b) => b.volume - a.volume), // ordenar por volumen
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
