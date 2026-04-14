/**
 * Endpoint de debug — muestra qué devuelve la API de Polymarket
 * con y sin filtros aplicados
 * Acceder en: /api/debug-markets
 */
export default async function handler(req, res) {
  try {
    const res1 = await fetch(
      `https://gamma-api.polymarket.com/markets?active=true&closed=false&tag_slug=sports&limit=100`
    );
    const markets = await res1.json();

    const minVolume = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
    const requireVs = process.env.REQUIRE_VS_FORMAT !== 'false';

    // Aplicar los mismos filtros que polymarket.js
    const pasanFiltro = (markets || []).filter(m => {
      const vol = parseFloat(m.volume) || 0;
      const hasVs = requireVs ? m.question?.includes(' vs ') : true;
      return vol > minVolume && hasVs;
    });

    // Para debug: mostrar top 10 por volumen sin filtro vs
    const topPorVolumen = (markets || [])
      .map(m => ({
        question: m.question,
        volume: parseFloat(m.volume) || 0,
        active: m.active,
        closed: m.closed,
        hasVs: m.question?.includes(' vs '),
        marketId: m.conditionId || m.condition_id,
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);

    return res.json({
      total_raw: markets.length,
      pasan_filtro: pasanFiltro.length,
      filtros_activos: { minVolume, requireVs },
      top10_por_volumen: topPorVolumen,
      primeros_3_pasan_filtro: pasanFiltro.slice(0, 3).map(m => ({
        question: m.question,
        volume: parseFloat(m.volume) || 0,
        active: m.active,
        closed: m.closed,
        conditionId: m.conditionId || m.condition_id,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
