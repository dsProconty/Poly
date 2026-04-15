const CLOB_BASE    = 'https://clob.polymarket.com';
const GAMMA_BASE   = 'https://gamma-api.polymarket.com';
const GATEWAY_BASE = 'https://gateway.polymarket.com';

const MIN_VOLUME    = parseFloat(process.env.MIN_MARKET_VOLUME   || '100');
const MIN_YES_PROB  = parseFloat(process.env.MIN_YES_PROB        || '20');
const MAX_YES_PROB  = parseFloat(process.env.MAX_YES_PROB        || '80');
const MAX_DAYS      = parseInt(process.env.MAX_DAYS_TO_RESOLVE   || '7');

// La Gamma API ignora tag_slug — paginamos sin tag y filtramos por keywords
const PAGES_TO_FETCH = 3; // 3 × 100 = 300 mercados

// ─── BLOCKLISTS ────────────────────────────────────────────────────────────

// Temas NO deportivos que Polymarket mezcla bajo tag "sports"
const NON_SPORTS = [
  // Política
  'invade','invasion','taiwan','ceasefire','election','president',
  'congress','senate','nuclear','war ','legislation','government',
  'treaty','sanctions','referendum',
  // Crypto / finanzas
  'bitcoin','btc','ethereum','eth','crypto','token','nft','coin',
  'stock','nasdaq','s&p','interest rate','fed rate','recession',
  // Entretenimiento / cultura pop
  'gta','album','movie','film','song','award','oscar','grammy',
  'emmy','box office','rihanna','taylor','kanye','drake','carti',
  'playboi','rapper','singer','actress','actor',
  // Religión / sci-fi
  'jesus','christ','god ','allah','alien','ufo','apocalypse',
  // Clima
  'hurricane','earthquake','tornado','flood','tsunami',
  // Tech
  'iphone','android','openai','chatgpt','tesla','spacex',
];

// Futuros de temporada completa (resuelven en meses)
// NO incluir series de playoffs — esas resuelven en días/semanas
const FUTURES = [
  'nba champion','nba mvp',
  'super bowl','nfl champion','nfl mvp',
  'world series','mlb champion','cy young',
  'stanley cup','nhl champion','hart trophy','vezina',
  'win the league','win the pennant','win the season',
  'la liga title','premier league title','bundesliga title',
  'serie a title','ligue 1 title',
  'champions league winner','world cup winner',
  'ballon d\'or','mvp award','rookie of the year',
  'heisman','golden boot','golden glove',
];

// Esports
const ESPORTS = [
  'counter-strike','cs2','csgo','valorant','dota','league of legends',
  'lol ','overwatch','rocket league','fortnite','pubg','esport',
  'starcraft','hearthstone','call of duty warzone',
];

// Props que no son ganador del partido
const PROPS = [
  'set winner','game winner','map winner','total games','total sets',
  'total maps','over/','under/','spread','handicap',' ats ',
  'bo3','bo5','best of 3','best of 5','first to','most aces',
  'most kills','player props','anytime scorer','correct score',
  'both teams to score','clean sheet',
];

// Palabras que CONFIRMAN que es un partido deportivo real
const SPORTS_CONFIRM = [
  ' vs ',' v. ',' @ ',
  'match winner','match result','moneyline','win the game','win the match',
  'beats ','defeats ','beat ','defeat ',
  // Ligas y torneos específicos
  'nba','nfl','mlb','nhl','mls','ufc','atp','wta','pga',
  'premier league','la liga','champions league','europa league',
  'bundesliga','serie a','ligue 1','eredivisie','mls',
  'ncaa','march madness',
  'copa america','euro ','world cup','davis cup','grand slam',
  'wimbledon','us open','french open','australian open',
  'ipl','cricket','nrl','afl','super rugby',
  ' playoff',' playoffs','conference final','semifinal','quarterfinal',
];

// ─── HELPERS ───────────────────────────────────────────────────────────────

function isRealSportsMatch(m) {
  const text = ((m.question || '') + ' ' + (m.title || '')).toLowerCase();
  const type  = (m.sportsMarketType || '').toLowerCase();

  if (FUTURES.some(k => text.includes(k)))      return false;
  if (NON_SPORTS.some(k => text.includes(k)))   return false;
  if (ESPORTS.some(k => text.includes(k)))      return false;
  if (PROPS.some(k => text.includes(k)))        return false;

  // Tipo explícito de Polymarket — moneyline siempre es partido directo
  if (['moneyline','cricket_completed_match','soccer_team_to_advance'].includes(type)) return true;

  return SPORTS_CONFIRM.some(k => text.includes(k));
}

function parseYesPrice(m) {
  if (Array.isArray(m.tokens)) {
    const t = m.tokens.find(t =>
      t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes'
    );
    if (t?.price) return parseFloat(t.price);
  }
  let outcomes = m.outcomes;
  let prices   = m.outcomePrices;
  if (typeof outcomes === 'string') { try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; } }
  if (typeof prices   === 'string') { try { prices   = JSON.parse(prices);   } catch { prices   = []; } }
  if (Array.isArray(outcomes) && Array.isArray(prices)) {
    const idx = outcomes.findIndex(o =>
      (typeof o === 'string' ? o : o?.name || '').toLowerCase() === 'yes'
    );
    if (idx >= 0) return parseFloat(prices[idx]) || 0;
  }
  return 0;
}

function normalizeSport(question, tags) {
  const t = ((question || '') + ' ' + JSON.stringify(tags || '')).toLowerCase();
  if (/\bnba\b|lakers|celtics|warriors|knicks|bulls|heat|bucks|nets|suns|clippers/.test(t)) return 'NBA';
  if (/\bnfl\b|packers|cowboys|chiefs|patriots|eagles|49ers|ravens|bills/.test(t))           return 'NFL';
  if (/\bnhl\b|hockey|bruins|maple leafs|penguins|rangers|avalanche|oilers/.test(t))         return 'NHL';
  if (/\bmlb\b|baseball|dodgers|yankees|mets|cubs|red sox|astros|braves/.test(t))            return 'MLB';
  if (/\bmma\b|\bufc\b|boxing/.test(t))                                                       return 'MMA';
  if (/\batp\b|\bwta\b|tennis|sinner|alcaraz|djokovic|nadal|federer|swiatek/.test(t))        return 'TENNIS';
  if (/champions league/.test(t))                                                             return 'UCL';
  if (/premier league|epl/.test(t))                                                           return 'EPL';
  if (/la liga/.test(t))                                                                      return 'LA_LIGA';
  if (/bundesliga/.test(t))                                                                   return 'BUNDESLIGA';
  if (/serie a/.test(t))                                                                      return 'SERIE_A';
  if (/ligue 1/.test(t))                                                                      return 'LIGUE_1';
  if (/cricket|ipl/.test(t))                                                                  return 'CRICKET';
  if (/\bncaa\b|march madness|college/.test(t))                                               return 'NCAA';
  if (/\bmls\b/.test(t))                                                                      return 'MLS';
  // Ligas latinoamericanas
  if (/liga mx|america|chivas|cruz azul|pumas|tigres|monterrey|santos|leon/.test(t))          return 'LIGA_MX';
  if (/river plate|boca junior|racing|independiente|san lorenzo|estudiantes/.test(t))         return 'ARGENTINA';
  if (/america de cali|millonarios|nacional|junior|santa fe|once caldas/.test(t))             return 'COLOMBIA';
  if (/flamengo|palmeiras|corinthians|atletico mineiro|fluminense|santos/.test(t))            return 'BRAZIL';
  // Fútbol africano / otros
  if (/olympic|wydad|raja|ahly|zamalek|esperance|sfaxien/.test(t))                           return 'AFRICA';
  // Patrón genérico: "win on YYYY-MM-DD" → probablemente fútbol
  if (/win on \d{4}-\d{2}-\d{2}/.test(t))                                                    return 'SOCCER';
  if (/soccer|football/.test(t))                                                              return 'SOCCER';
  return 'SOCCER'; // Default — la mayoría de mercados sin keyword son fútbol
}

function resolvesWithinDays(endDate) {
  if (!endDate) return true;
  const diff = (new Date(endDate) - new Date()) / 86400000;
  return diff >= 0 && diff <= MAX_DAYS;
}

function toMarket(m) {
  const yesPrice = parseYesPrice(m);
  return {
    marketId: m.conditionId || m.condition_id,
    question: m.question,
    sport:    normalizeSport(m.question, m.tags),
    volume:   parseFloat(m.volume)    || 0,
    liquidity:parseFloat(m.liquidity) || 0,
    yesProb:  yesPrice * 100,
    noProb:   (1 - yesPrice) * 100,
    startDate:m.startDate || m.gameStartTime,
    endDate:  m.endDate   || m.end_date_iso,
    resolved: m.resolved  || false,
    outcome:  m.outcome   || null,
  };
}

// ─── EXPORTED FUNCTIONS ────────────────────────────────────────────────────

/**
 * Gateway API — devuelve eventos deportivos del día (NBA, MLB, NHL, etc.)
 * Esta es la fuente que usa el SussyImplementation para mercados "live"
 */
async function fetchGatewayEvents() {
  try {
    const res = await fetch(
      `${GATEWAY_BASE}/sports-markets?active=true&closed=false&limit=100`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.markets || data.events || []);
  } catch {
    return [];
  }
}

/**
 * Pagina la Gamma API (3 × 100 = 300 mercados) ordenados por endDate.
 * Fallback cuando Gateway no da resultados.
 */
async function fetchAllMarkets() {
  const pages = Array.from({ length: PAGES_TO_FETCH }, (_, i) => i);
  const batches = await Promise.all(pages.map(i =>
    fetch(`${GAMMA_BASE}/markets?active=true&closed=false&archived=false&limit=100&offset=${i * 100}&order=endDate&ascending=true`)
      .then(r => r.ok ? r.json() : [])
      .catch(() => [])
  ));
  const raw = batches.flat();
  const seen = new Set();
  return raw.filter(m => {
    const id = m.conditionId || m.condition_id;
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });
}

function applyFilters(markets, withDateFilter) {
  return markets
    .filter(isRealSportsMatch)
    .map(toMarket)
    .filter(m =>
      m.volume   > MIN_VOLUME   &&
      m.yesProb >= MIN_YES_PROB &&
      m.yesProb <= MAX_YES_PROB &&
      (!withDateFilter || resolvesWithinDays(m.endDate))
    )
    .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
}

export async function getSportsMarkets() {
  // Intentar Gateway primero (mercados del día)
  const gateway = await fetchGatewayEvents();
  if (gateway.length) {
    const filtered = applyFilters(gateway, true);
    if (filtered.length) return filtered;
  }

  // Fallback a Gamma paginado
  const unique = await fetchAllMarkets();
  return applyFilters(unique, true);
}

/**
 * Fallback — sin filtro de fecha.
 */
export async function getSportsMarketsFromMarkets() {
  const [gateway, gamma] = await Promise.all([fetchGatewayEvents(), fetchAllMarkets()]);
  const seen = new Set();
  const combined = [...gateway, ...gamma].filter(m => {
    const id = m.conditionId || m.condition_id;
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });
  return applyFilters(combined, false);
}

/**
 * Estado de un mercado por condition_id (para resolve-positions).
 */
export async function getMarketById(conditionId) {
  const res = await fetch(`${CLOB_BASE}/markets/${conditionId}`);
  if (!res.ok) throw new Error(`CLOB error ${conditionId}: ${res.status}`);
  const m = await res.json();
  return {
    marketId: m.condition_id,
    question: m.question,
    resolved: m.resolved || false,
    outcome:  m.outcome  || null,
  };
}
