const CLOB_BASE = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const MIN_VOLUME = parseFloat(process.env.MIN_MARKET_VOLUME || '1500');
const REQUIRE_VS = process.env.REQUIRE_VS_FORMAT !== 'false';
const MIN_YES_PROB = parseFloat(process.env.MIN_YES_PROB || '15');
const MAX_YES_PROB = parseFloat(process.env.MAX_YES_PROB || '85');
// Solo mercados que resuelven en los próximos N días (default 14)
const MAX_DAYS_TO_RESOLVE = parseInt(process.env.MAX_DAYS_TO_RESOLVE || '14');

// ─────────────────────────────────────────────────────────────
// FILTRO DE CALIDAD: solo mercados de ganador de partido real
// Rechaza esports, props, handicaps, over/under, series Bo3/Bo5
// y temas que no son deportes (política, crypto, entretenimiento)
// ─────────────────────────────────────────────────────────────
const ESPORTS_KEYWORDS = [
  'counter-strike', 'cs2', 'csgo', 'valorant', 'dota', 'league of legends',
  'lol', 'overwatch', 'rocket league', 'fortnite', 'pubg', 'esport',
];

const PROP_KEYWORDS = [
  'set winner', 'game winner', 'map winner',
  'total games', 'total sets', 'total maps',
  'over/', 'under/', 'spread', 'handicap', 'ats',
  'bo3', 'bo5', 'best of 3', 'best of 5',
  'first to', 'most aces', 'most kills',
  'player props', 'anytime scorer',
];

// Temas que NO son deportes — rechazar aunque `tag_slug=sports` los devuelva
const NON_SPORTS_KEYWORDS = [
  // Política / geopolítica
  'invade', 'invasion', 'taiwan', 'war ', 'ceasefire', 'election',
  'president', 'congress', 'senate', 'legislation', 'nuclear',
  // Crypto / finanzas
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'token', 'nft',
  'stock market', 'fed rate', 'interest rate',
  // Entretenimiento / cultura
  'gta vi', 'gta 6', 'album', 'movie', 'film', 'song', 'award',
  'oscar', 'grammy', 'emmy', 'box office',
  // Religión / ciencia ficción
  'jesus', 'christ', 'god ', 'alien', 'ufo',
  // Clima / catástrofes
  'hurricane', 'earthquake', 'tornado',
];

// Mercados de temporada completa (futuros) — resuelven en meses, no días
const FUTURES_KEYWORDS = [
  'stanley cup', 'nba finals', 'nba champion', 'super bowl',
  'world series', 'nhl champion', 'mlb champion', 'nfl champion',
  'win the cup', 'win the title', 'win the league', 'win the season',
  'la liga title', 'premier league title', 'bundesliga title',
  'champions league winner', 'world cup winner',
  'mvp', 'rookie of the year', 'cy young', 'hart trophy',
];

// Palabras que SÍ confirman que es deporte
const SPORTS_CONFIRM_KEYWORDS = [
  ' vs ', ' v ', ' @ ', ' at ',
  'match winner', 'match result', 'moneyline',
  'win the game', 'win the match', 'win the series',
  'beats ', 'defeats ', 'advance to',
  // Deportes específicos
  'nba', 'nfl', 'mlb', 'nhl', 'mls', 'ufc', 'atp', 'wta',
  'premier league', 'la liga', 'champions league', 'bundesliga',
  'serie a', 'ligue 1', 'ncaa', 'world cup',
  'finals', 'playoff', 'championship game',
];

const ACCEPTED_MARKET_TYPES = [
  'moneyline', 'cricket_completed_match', 'soccer_team_to_advance',
];

function isDirectSportsOutcome(m) {
  const q = (m.question || '').toLowerCase();
  const title = (m.title || '').toLowerCase();
  const text = q + ' ' + title;
  const marketType = (m.sportsMarketType || '').toLowerCase();

  // Rechazar futuros de temporada completa (Stanley Cup, NBA Finals, etc.)
  if (FUTURES_KEYWORDS.some(kw => text.includes(kw))) return false;

  // Rechazar temas no deportivos
  if (NON_SPORTS_KEYWORDS.some(kw => text.includes(kw))) return false;

  // Rechazar esports
  if (ESPORTS_KEYWORDS.some(kw => text.includes(kw))) return false;

  // Rechazar props y mercados secundarios
  if (PROP_KEYWORDS.some(kw => text.includes(kw))) return false;

  // Aceptar por tipo explícito si está disponible
  if (marketType && ACCEPTED_MARKET_TYPES.includes(marketType)) return true;

  // Requiere al menos una palabra clave de deporte confirmada
  if (SPORTS_CONFIRM_KEYWORDS.some(kw => text.includes(kw))) return true;

  return false;
}

/**
 * Verifica que el mercado resuelva dentro del horizonte de días configurado.
 */
function resolvesWithinWindow(endDate) {
  if (!endDate) return true; // si no hay fecha, no filtrar
  const end = new Date(endDate);
  const now = new Date();
  const diffDays = (end - now) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= MAX_DAYS_TO_RESOLVE;
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
  // endDate ascending → los que resuelven antes primero (partidos próximos)
  const res = await fetch(
    `${GAMMA_BASE}/markets?active=true&closed=false&archived=false&tag_slug=sports&limit=100&order=endDate&ascending=true`
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
      const resolveSoon = resolvesWithinWindow(m.endDate);
      return hasVs && hasVolume && hasBalancedProb && resolveSoon;
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
