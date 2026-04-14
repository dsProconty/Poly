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
    const minYesProb = parseFloat(process.env.MIN_YES_PROB || '15');
    const maxYesProb = parseFloat(process.env.MAX_YES_PROB || '85');

    // Parsear precios de cada mercado
    const parsed = (markets || []).map(m => {
      let yesPrice = 0;
      if (Array.isArray(m.tokens)) {
        const t = m.tokens.find(t => t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes');
        yesPrice = parseFloat(t?.price || 0);
      }
      if (yesPrice === 0) {
        let outcomes = m.outcomes;
        let prices = m.outcomePrices;
        if (typeof outcomes === 'string') { try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; } }
        if (typeof prices === 'string') { try { prices = JSON.parse(prices); } catch { prices = []; } }
        if (Array.isArray(outcomes) && Array.isArray(prices)) {
          const idx = outcomes.findIndex(o => (typeof o === 'string' ? o : o?.name || '').toLowerCase() === 'yes');
          if (idx >= 0) yesPrice = parseFloat(prices[idx]) || 0;
        }
      }
      return {
        question: m.question,
        volume: parseFloat(m.volume) || 0,
        yesProb: yesPrice * 100,
        hasVs: m.question?.includes(' vs '),
        conditionId: m.conditionId || m.condition_id,
        endDate: m.endDate || m.end_date_iso,
      };
    });

    // Aplicar todos los filtros
    const pasanFiltro = parsed.filter(m => {
      const hasVs = requireVs ? m.hasVs : true;
      const balanced = m.yesProb >= minYesProb && m.yesProb <= maxYesProb;
      return m.volume > minVolume && hasVs && balanced;
    }).sort((a, b) => b.volume - a.volume);

    // Top 10 por volumen sin filtro de probabilidad (para diagnóstico)
    const top10 = [...parsed]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10)
      .map(m => ({ question: m.question, volume: m.volume, yesProb: m.yesProb.toFixed(1) + '%', pasaFiltroProb: m.yesProb >= minYesProb && m.yesProb <= maxYesProb }));

    return res.json({
      total_raw: markets.length,
      pasan_filtro: pasanFiltro.length,
      filtros_activos: { minVolume, requireVs, minYesProb, maxYesProb },
      top10_por_volumen: top10,
      candidatos_para_bot: pasanFiltro.slice(0, 5).map(m => ({
        question: m.question,
        yesProb: m.yesProb.toFixed(1) + '%',
        volume: m.volume,
        endDate: m.endDate,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
