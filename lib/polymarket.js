const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const MIN_VOLUME = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
const REQUIRE_VS = process.env.REQUIRE_VS_FORMAT !== 'false';
// Sólo mercados donde el resultado es incierto: probabilidad YES entre 15% y 85%
// Esto filtra mercados del tipo "¿Ganará el peor equipo el campeonato?" (1-5%)
const MIN_YES_PROB = parseFloat(process.env.MIN_YES_PROB || '15');
const MAX_YES_PROB = parseFloat(process.env.MAX_YES_PROB || '85');

/**
 * Obtiene mercados deportivos activos de Polymarket
 * Usa la Gamma API que sí incluye datos de volumen
 * Filtra para quedarse con mercados competitivos (probabilidad balanceada)
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
    .map(m => {
      // Gamma API devuelve outcomes como array de strings ["Yes","No"]
      // y outcomePrices como array de strings ["0.65","0.35"]
      // También puede venir como JSON string o como array de objetos (CLOB)
      let yesPrice = 0;

      // Caso 1: array de objetos con .price (CLOB format)
      const tokensRaw = m.tokens;
      if (Array.isArray(tokensRaw)) {
        const yesToken = tokensRaw.find(t =>
          t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes'
        );
        yesPrice = parseFloat(yesToken?.price || 0);
      }

      // Caso 2: Gamma API — outcomes=["Yes","No"], outcomePrices=["0.65","0.35"]
      if (yesPrice === 0) {
        let outcomes = m.outcomes;
        let prices = m.outcomePrices;

        if (typeof outcomes === 'string') {
          try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; }
        }
        if (typeof prices === 'string') {
          try { prices = JSON.parse(prices); } catch { prices = []; }
        }

        if (Array.isArray(outcomes) && Array.isArray(prices)) {
          const yesIdx = outcomes.findIndex(o =>
            typeof o === 'string' ? o.toLowerCase() === 'yes' : o?.name?.toLowerCase() === 'yes'
          );
          if (yesIdx >= 0) yesPrice = parseFloat(prices[yesIdx]) || 0;
        }
      }

      return {
        marketId: m.conditionId || m.condition_id,
        question: m.question,
        volume: parseFloat(m.volume) || 0,
        yesProb: yesPrice * 100,
        noProb: (1 - yesPrice) * 100,
        endDate: m.endDate || m.end_date_iso,
        resolved: m.resolved || false,
        outcome: m.outcome || null,
      };
    })
    .filter(m => {
      const vol = m.volume;
      const hasVs = REQUIRE_VS ? m.question?.includes(' vs ') : true;
      // Filtrar mercados con probabilidad demasiado extrema (casi certeza)
      const hasBalancedProb = m.yesProb >= MIN_YES_PROB && m.yesProb <= MAX_YES_PROB;
      return vol > MIN_VOLUME && hasVs && hasBalancedProb;
    })
    .sort((a, b) => b.volume - a.volume);
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
