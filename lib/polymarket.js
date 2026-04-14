const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const MIN_VOLUME = parseFloat(process.env.MIN_MARKET_VOLUME || '1500');
const REQUIRE_VS = process.env.REQUIRE_VS_FORMAT !== 'false';
const MIN_YES_PROB = parseFloat(process.env.MIN_YES_PROB || '15');
const MAX_YES_PROB = parseFloat(process.env.MAX_YES_PROB || '85');

// ─────────────────────────────────────────────────────────────
// FILTRO DE CALIDAD: solo mercados de ganador de partido real
// Rechaza esports, props, handicaps, over/under, series Bo3/Bo5
// ─────────────────────────────────────────────────────────────
const ESPORTS_KEYWORDS = [
  'counter-strike', 'cs2', 'csgo', 'valorant', 'dota', 'league of legends',
  'lol', 'overwatch', 'rocket league', 'fortnite', 'pubg', 'esport',
];

const PROP_KEYWORDS = [
  'set winner', 'game winner', 'map winner',
  'total games', 'total sets', 'total maps',
  'over/', 'under/', 'over ', 'under ',
  'spread', 'handicap', 'ats',
  'bo3', 'bo5', 'best of 3', 'best of 5',
  'first to', 'most aces', 'most kills',
  'player props', 'anytime scorer',
];

const ACCEPTED_MARKET_TYPES = [
  'moneyline', 'cricket_completed_match', 'soccer_team_to_advance',
];

function isDirectSportsOutcome(m) {
  const q = (m.question || '').toLowerCase();
  const title = (m.title || '').toLowerCase();
  const text = q + ' ' + title;
  const marketType = (m.sportsMarketType || '').toLowerCase();

  // Rechazar esports
  if (ESPORTS_KEYWORDS.some(kw => text.includes(kw))) return false;

  // Rechazar props y mercados secundarios
  if (PROP_KEYWORDS.some(kw => text.includes(kw))) return false;

  // Aceptar por tipo explícito si está disponible
  if (marketType && ACCEPTED_MARKET_TYPES.includes(marketType)) return true;

  // Aceptar por patrones de pregunta (match winner directo)
  const acceptPatterns = [
    ' vs ', ' @ ', ' at ',
    'match winner', 'match result', 'moneyline',
    'will ', // "Will X win?", "Will X beat Y?"
  ];
  if (acceptPatterns.some(p => text.includes(p))) return true;

  return false;
}

/**
 * Parsea el precio YES de un mercado de la Gamma API.
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
 * Obtiene mercados deportivos activos ordenados por fecha de inicio (próximos primero).
 * Filtra esports, props, over/under y mercados con probabilidad extrema.
 */
export async function getSportsMarkets() {
  // order=startDate&ascending=true → próximos partidos primero
  const res = await fetch(
    `${GAMMA_BASE}/markets?active=true&closed=false&archived=false&tag_slug=sports&limit=100&order=startDate&ascending=true`
  );

  if (!res.ok) {
    throw new Error(`Polymarket Gamma API error: ${res.status}`);
  }

  const markets = await res.json();

  return (markets || [])
    .filter(isDirectSportsOutcome)
    .map(m => {
      const yesPrice = parseYesPrice(m);
      return {
        marketId: m.conditionId || m.condition_id,
        question: m.question,
        title: m.title || m.question,
        sport: normalizeSport(m.question, m.tags),
        volume: parseFloat(m.volume) || 0,
        liquidity: parseFloat(m.liquidity) || 0,
        yesProb: yesPrice * 100,
        noProb: (1 - yesPrice) * 100,
        startDate: m.startDate || m.gameStartTime,
        endDate: m.endDate || m.end_date_iso,
        resolved: m.resolved || false,
        outcome: m.outcome || null,
      };
    })
    .filter(m => {
      const hasVs = REQUIRE_VS ? m.question?.includes(' vs ') : true;
      const hasVolume = m.volume > MIN_VOLUME;
      const hasBalancedProb = m.yesProb >= MIN_YES_PROB && m.yesProb <= MAX_YES_PROB;
      return hasVs && hasVolume && hasBalancedProb;
    });
}

/**
 * Clasifica el mercado en una categoría deportiva.
 */
function normalizeSport(question, tags) {
  const text = ((question || '') + ' ' + JSON.stringify(tags || '')).toLowerCase();

  if (/\bnba\b|lakers|celtics|warriors|knicks|bulls|heat|bucks|sixers/.test(text)) return 'NBA';
  if (/\bnfl\b|packers|cowboys|chiefs|patriots|eagles|49ers/.test(text)) return 'NFL';
  if (/\bnhl\b|hockey|bruins|maple leafs|penguins|rangers/.test(text)) return 'NHL';
  if (/\bmlb\b|baseball|dodgers|yankees|mets|cubs|red sox/.test(text)) return 'MLB';
  if (/\bmma\b|\bufc\b|boxing/.test(text)) return 'MMA';
  if (/tennis|atp|wta|sinner|alcaraz|djokovic|federer|nadal/.test(text)) return 'TENNIS';
  if (/champions league/.test(text)) return 'CHAMPIONS_LEAGUE';
  if (/premier league|epl/.test(text)) return 'EPL';
  if (/la liga/.test(text)) return 'LA_LIGA';
  if (/cricket|ipl/.test(text)) return 'CRICKET';
  if (/ncaa|college/.test(text)) return 'NCAA';
  if (/soccer|football|mls|bundesliga|serie a|ligue 1/.test(text)) return 'SOCCER';

  return 'SPORTS';
}

/**
 * Fallback: si el filtro estricto deja 0 mercados, relaja los filtros.
 */
export async function getSportsMarketsFromMarkets() {
  const res = await fetch(
    `${GAMMA_BASE}/markets?active=true&closed=false&tag_slug=sports&limit=100&order=startDate&ascending=true`
  );

  if (!res.ok) throw new Error(`Polymarket Gamma API error: ${res.status}`);

  const markets = await res.json();

  return (markets || [])
    .map(m => {
      const yesPrice = parseYesPrice(m);
      return {
        marketId: m.conditionId || m.condition_id,
        question: m.question,
        sport: normalizeSport(m.question, m.tags),
        volume: parseFloat(m.volume) || 0,
        yesProb: yesPrice * 100,
        noProb: (1 - yesPrice) * 100,
        startDate: m.startDate || m.gameStartTime,
        endDate: m.endDate || m.end_date_iso,
        resolved: m.resolved || false,
        outcome: m.outcome || null,
      };
    })
    .filter(m => {
      const hasVs = REQUIRE_VS ? m.question?.includes(' vs ') : true;
      return m.volume > MIN_VOLUME && hasVs && m.yesProb >= MIN_YES_PROB && m.yesProb <= MAX_YES_PROB;
    });
}

/**
 * Obtiene el estado actual de un mercado por su condition_id.
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
