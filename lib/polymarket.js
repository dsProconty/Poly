const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const MIN_VOLUME = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
const REQUIRE_VS = process.env.REQUIRE_VS_FORMAT !== 'false';

/**
 * Obtiene mercados deportivos activos de Polymarket
 * Usa la Gamma API que sí incluye datos de volumen
 */
export async function getSportsMarkets() {
  const res = await fetch(
    `${GAMMA_BASE}/markets?active=true&closed=false&tag_slug=sports&limit=100`
  );

  if (!res.ok) {
    throw new Error(`Polymarket Gamma API error: ${res.status}`);
  }

  const markets = await res.json();

  return (markets || [])
    .filter(m => {
      const vol = parseFloat(m.volume) || 0;
      const hasVs = REQUIRE_VS ? m.question?.includes(' vs ') : true;
      return vol > MIN_VOLUME && hasVs;
    })
    .map(m => {
      const tokens = m.tokens || m.outcomes || [];
      const yesToken = tokens.find(t =>
        t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes'
      );
      return {
        marketId: m.conditionId || m.condition_id,
        question: m.question,
        volume: parseFloat(m.volume) || 0,
        yesProb: parseFloat(yesToken?.price || 0) * 100,
        noProb: 100 - parseFloat(yesToken?.price || 0) * 100,
        endDate: m.endDate || m.end_date_iso,
        resolved: m.resolved || false,
        outcome: m.outcome || null,
      };
    });
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
    outcome: m.outcome || null,
  };
}
