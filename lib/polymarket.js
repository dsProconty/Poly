const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const MIN_VOLUME = parseFloat(process.env.MIN_MARKET_VOLUME || '500');
const REQUIRE_VS = process.env.REQUIRE_VS_FORMAT !== 'false';
// Sólo mercados donde el resultado es incierto: probabilidad YES entre 15% y 85%
const MIN_YES_PROB = parseFloat(process.env.MIN_YES_PROB || '15');
const MAX_YES_PROB = parseFloat(process.env.MAX_YES_PROB || '85');

/**
 * Parsea el precio YES de un mercado de la Gamma API.
 * Soporta tanto objetos token (CLOB) como arrays de strings (Gamma).
 */
function parseYesPrice(m) {
  // Caso 1: tokens con .price (formato CLOB)
  if (Array.isArray(m.tokens)) {
    const t = m.tokens.find(t =>
      t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes'
    );
    if (t?.price) return parseFloat(t.price);
  }

  // Caso 2: outcomes=["Yes","No"] + outcomePrices=["0.65","0.35"] (formato Gamma)
  let outcomes = m.outcomes;
  let prices = m.outcomePrices;
  if (typeof outcomes === 'string') { try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; } }
  if (typeof prices === 'string') { try { prices = JSON.parse(prices); } catch { prices = []; } }

  if (Array.isArray(outcomes) && Array.isArray(prices)) {
    const idx = outcomes.findIndex(o =>
      (typeof o === 'string' ? o : o?.name || '').toLowerCase() === 'yes'
    );
    if (idx >= 0) return parseFloat(prices[idx]) || 0;
  }

  return 0;
}

/**
 * Obtiene mercados deportivos activos de Polymarket usando el endpoint /events.
 * /events agrupa los mercados por partido real (ej: "Lakers vs Warriors")
 * y da datos más precisos que /markets.
 */
export async function getSportsMarkets() {
  const res = await fetch(
    `${GAMMA_BASE}/events?active=true&closed=false&tag_slug=sports&limit=50`
  );

  if (!res.ok) {
    throw new Error(`Polymarket Gamma API error: ${res.status}`);
  }

  const events = await res.json();
  const results = [];

  for (const event of (events || [])) {
    // Cada evento tiene un array de mercados asociados
    const eventMarkets = event.markets || [];

    for (const m of eventMarkets) {
      const vol = parseFloat(m.volume) || parseFloat(event.volume) || 0;
      if (vol < MIN_VOLUME) continue;

      // El título del evento es más descriptivo que la question del mercado
      const question = m.question || event.title || '';
      if (REQUIRE_VS && !question.includes(' vs ')) continue;

      const yesPrice = parseYesPrice(m);
      const yesProb = yesPrice * 100;

      // Filtrar por probabilidad balanceada
      if (yesProb < MIN_YES_PROB || yesProb > MAX_YES_PROB) continue;

      results.push({
        marketId: m.conditionId || m.condition_id,
        question,
        eventTitle: event.title,
        sport: event.category || event.tag || 'Sports',
        volume: vol,
        yesProb,
        noProb: (1 - yesPrice) * 100,
        endDate: m.endDate || m.end_date_iso || event.endDate,
        resolved: m.resolved || false,
        outcome: m.outcome || null,
      });
    }
  }

  // Ordenar por volumen descendente
  return results.sort((a, b) => b.volume - a.volume);
}

/**
 * Fallback: si /events no da resultados, usa /markets directamente.
 */
export async function getSportsMarketsFromMarkets() {
  const res = await fetch(
    `${GAMMA_BASE}/markets?active=true&closed=false&tag_slug=sports&limit=100`
  );

  if (!res.ok) throw new Error(`Polymarket Gamma API error: ${res.status}`);

  const markets = await res.json();

  return (markets || [])
    .map(m => {
      const yesPrice = parseYesPrice(m);
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
      const hasVs = REQUIRE_VS ? m.question?.includes(' vs ') : true;
      return m.volume > MIN_VOLUME && hasVs && m.yesProb >= MIN_YES_PROB && m.yesProb <= MAX_YES_PROB;
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
