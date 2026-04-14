const CLOB_BASE = 'https://clob.polymarket.com';

/**
 * Obtiene mercados deportivos activos de Polymarket
 * Filtra por volumen mínimo y formato "X vs Y"
 *
 * MIN_VOLUME: bajar a 1 para testing, subir a 500 para producción
 * REQUIRE_VS: false para testing (acepta cualquier pregunta deportiva)
 */
const MIN_VOLUME = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
const REQUIRE_VS = process.env.REQUIRE_VS_FORMAT !== 'false';

export async function getSportsMarkets() {
  const res = await fetch(`${CLOB_BASE}/markets?active=true&tag_id=12`);

  if (!res.ok) {
    throw new Error(`Polymarket API error: ${res.status}`);
  }

  const data = await res.json();

  return (data.data || [])
    .filter(m =>
      parseFloat(m.volume) > MIN_VOLUME &&
      (REQUIRE_VS ? m.question?.includes(' vs ') : true)
    )
    .map(m => ({
      marketId: m.condition_id,
      question: m.question,
      volume: parseFloat(m.volume),
      yesProb: parseFloat(m.tokens?.find(t => t.outcome === 'Yes')?.price || 0) * 100,
      noProb: parseFloat(m.tokens?.find(t => t.outcome === 'No')?.price || 0) * 100,
      endDate: m.end_date_iso,
      resolved: m.resolved || false,
      outcome: m.outcome || null,
    }));
}

/**
 * Obtiene el estado actual de un mercado por su condition_id
 * Usado por resolve-positions para verificar si ya resolvió
 */
export async function getMarketById(conditionId) {
  const res = await fetch(`${CLOB_BASE}/markets/${conditionId}`);

  if (!res.ok) {
    throw new Error(`Polymarket API error al buscar mercado ${conditionId}: ${res.status}`);
  }

  const m = await res.json();

  return {
    marketId: m.condition_id,
    question: m.question,
    resolved: m.resolved || false,
    outcome: m.outcome || null, // "Yes" / "No" / null
  };
}
