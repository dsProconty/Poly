const CLOB_BASE  = 'https://clob.polymarket.com';
const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const MIN_VOLUME    = parseFloat(process.env.MIN_MARKET_VOLUME   || '100');
const MIN_YES_PROB  = parseFloat(process.env.MIN_YES_PROB        || '20');
const MAX_YES_PROB  = parseFloat(process.env.MAX_YES_PROB        || '80');
const MAX_DAYS      = parseInt(process.env.MAX_DAYS_TO_RESOLVE   || '30');

// Gamma API: paginamos por fecha Y por volumen para capturar tanto partidos próximos
// como mercados populares (NBA/MLB/NHL) que pueden estar en páginas tardías si se ordena solo por fecha
const PAGES_BY_DATE   = 5; // 500 mercados ordenados por endDate asc (partidos próximos)
const PAGES_BY_VOLUME = 3; // 300 mercados ordenados por volumen desc (NBA/MLB/NHL populares)

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
  // Variantes de "ganar el mundial/torneo" sin la palabra "winner"
  'win the world cup','win the fifa','win the copa america',
  'win the euro ','win the euros','win the champions league',
  'win the premier league','win the la liga','win the bundesliga',
  'win the serie a','win the ligue 1',
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
  // Empates — el bot los predice mal y sesgan todas las apuestas
  'end in a draw','end in draw','in a draw?','will it be a draw',
  'draw at halftime','draw at half','halftime draw','draw in the',
  'result in a draw','finish in a draw','end as a draw',': draw ',': draw?',
  // Draft picks y eventos no deportivos que se cuelan
  'draft pick','be the first pick','be the second pick','be the third pick',
  'draft position','mock draft',
];

// Palabras que CONFIRMAN que es un partido deportivo real
const SPORTS_CONFIRM = [
  ' vs ',' vs. ',' v ',' v. ',' @ ',   // "Team A vs. Team B" y "Team A v Team B"
  'match winner','match result','moneyline','win the game','win the match',
  'win on 20',                           // "Will X win on 2025-11-28?" → fecha de partido
  'beats ','defeats ','beat ','defeat ',
  // Avance en competición
  'advance to','advance in','to advance',
  'to win the series','win the series',
  'win game ','to win game',             // "Will X win Game 3?"
  'game 1','game 2','game 3','game 4','game 5','game 6','game 7',
  // Ligas y torneos específicos
  'nba','nfl','mlb','nhl','mls','ufc','atp','wta','pga',
  'premier league','la liga','champions league','europa league',
  'conference league','bundesliga','serie a','ligue 1','eredivisie',
  'primeira liga','super lig',
  // Abreviaturas UEFA usadas en títulos de Polymarket
  'ucl ','uefa','cl final','cl quarter','cl semi',
  ' ufc ',' nba ',' nfl ',' mlb ',' nhl ',
  'ncaa','march madness',
  'copa america','euro ','world cup','davis cup','grand slam',
  'wimbledon','us open','french open','australian open',
  'ipl','cricket','nrl','afl','super rugby',
  ' playoff',' playoffs','conference final','semifinal','quarterfinal',
  // Equipos NBA más frecuentes (para títulos sin "vs" ni "nba")
  'celtics','lakers','warriors','nuggets','thunder','timberwolves',
  'cavaliers','knicks','pacers','heat','bucks','76ers',
  // Equipos MLB
  'yankees','dodgers','mets','cubs','red sox','astros','braves',
  'padres','phillies','giants','cardinals','diamondbacks','orioles',
  // Equipos NHL
  'bruins','maple leafs','rangers','penguins','avalanche','oilers',
  'panthers','lightning','capitals','jets','stars','kings',
];

// ─── HELPERS ───────────────────────────────────────────────────────────────

function isRealSportsMatch(m) {
  const text = ((m.question || '') + ' ' + (m.title || '')).toLowerCase();
  const type  = (m.sportsMarketType || '').toLowerCase();

  // FIX: rechazar mercados cuya fecha de partido YA PASÓ aunque el oráculo no haya resuelto.
  // Ej: "Will X win on 2026-02-02?" con endDate=2026-04-30 (oráculo lento).
  const pastDateMatch = text.match(/win on (\d{4}-\d{2}-\d{2})/);
  if (pastDateMatch && new Date(pastDateMatch[1]) < new Date()) return false;

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

// Tags de Polymarket Gamma Events para los deportes más activos
// IMPORTANTE: cada liga grande tiene su propio tag_slug, además del genérico 'soccer'
const SPORT_TAGS = [
  // Baloncesto
  'nba', 'nfl', 'mlb', 'nhl', 'mls', 'ufc', 'tennis',
  // Fútbol genérico
  'soccer',
  // Fútbol europeo — ligas y torneos con tag propio en Polymarket
  'champions-league', 'europa-league', 'conference-league',
  'premier-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-1',
  'eredivisie', 'primeira-liga', 'super-lig',
  // Otros torneos internacionales
  'world-cup', 'copa-america', 'euro-2024',
  // Baloncesto playoffs (temporada april-mayo)
  'nba-playoffs',
  // Cricket, rugby
  'cricket', 'rugby',
];

/**
 * Gamma Events API — consulta por sport tag_slug para obtener mercados del día.
 * Reemplaza la Gateway API que no funciona.
 * Cada tag devuelve hasta 200 eventos activos de esa liga.
 */
async function fetchEventsByTags() {
  try {
    const results = await Promise.all(
      SPORT_TAGS.map(tag =>
        fetch(`${GAMMA_BASE}/events?active=true&closed=false&tag_slug=${tag}&limit=200`)
          .then(r => r.ok ? r.json() : [])
          .then(data => {
            // /events devuelve array de eventos; cada evento tiene .markets[]
            const events = Array.isArray(data) ? data : (data.data || []);
            return events.flatMap(e => e.markets || [e]);
          })
          .catch(() => [])
      )
    );

    // Deduplicar por conditionId
    const seen = new Set();
    return results.flat().filter(m => {
      const id = m.conditionId || m.condition_id;
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    });
  } catch {
    return [];
  }
}

/**
 * Pagina la Gamma API en paralelo por dos criterios:
 *  - endDate ascendente: captura partidos que resuelven pronto
 *  - volume descendente: captura mercados populares (NBA/MLB/NHL) aunque tengan
 *    fecha lejana o estén enterrados en las páginas tardías del orden por fecha
 */
async function fetchAllMarkets() {
  const byDatePages   = Array.from({ length: PAGES_BY_DATE },   (_, i) => i);
  const byVolumePages = Array.from({ length: PAGES_BY_VOLUME }, (_, i) => i);

  const [byDate, byVolume] = await Promise.all([
    Promise.all(byDatePages.map(i =>
      fetch(`${GAMMA_BASE}/markets?active=true&closed=false&archived=false&limit=100&offset=${i * 100}&order=endDate&ascending=true`)
        .then(r => r.ok ? r.json() : []).catch(() => [])
    )).then(b => b.flat()),

    Promise.all(byVolumePages.map(i =>
      fetch(`${GAMMA_BASE}/markets?active=true&closed=false&archived=false&limit=100&offset=${i * 100}&order=volume&ascending=false`)
        .then(r => r.ok ? r.json() : []).catch(() => [])
    )).then(b => b.flat()),
  ]);

  // Combinar y deduplicar: por-fecha primero (prioridad cronológica)
  const raw = [...byDate, ...byVolume];
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
  // Fuente 1: Gamma Events por tag_slug (NBA, NHL, MLB, etc. — mercados del día)
  // Fuente 2: Gamma Markets paginado por fecha+volumen (cobertura amplia)
  // Ambas corren en paralelo para minimizar latencia
  const [tagMarkets, paginatedMarkets] = await Promise.all([
    fetchEventsByTags(),
    fetchAllMarkets(),
  ]);

  // Combinar y deduplicar — tag markets tienen prioridad (más relevantes)
  const seen = new Set();
  const combined = [...tagMarkets, ...paginatedMarkets].filter(m => {
    const id = m.conditionId || m.condition_id;
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });

  const filtered = applyFilters(combined, true);

  // Si no hay nada con filtro de fecha, relajar el filtro como último recurso
  if (!filtered.length) return applyFilters(combined, false);
  return filtered;
}

/**
 * Versión sin filtro de fecha — usada por debug-markets.
 */
export async function getSportsMarketsFromMarkets() {
  const [tagMarkets, paginatedMarkets] = await Promise.all([
    fetchEventsByTags(),
    fetchAllMarkets(),
  ]);
  const seen = new Set();
  const combined = [...tagMarkets, ...paginatedMarkets].filter(m => {
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

  // Precio YES desde tokens del CLOB
  let yesPrice = null;
  if (Array.isArray(m.tokens)) {
    const t = m.tokens.find(t => t.outcome?.toLowerCase() === 'yes');
    if (t?.price != null) yesPrice = parseFloat(t.price);
  }

  return {
    marketId:  m.condition_id,
    question:  m.question,
    resolved:  m.resolved  || false,
    outcome:   m.outcome   || null,
    yesPrice,                          // null si no disponible
  };
}
