/**
 * Debug — pagina mercados (por fecha Y por volumen) y muestra por qué se acepta/rechaza cada uno
 * GET /api/debug-markets
 */
const NON_SPORTS  = ['invade','invasion','taiwan','ceasefire','election','president','congress','senate','nuclear','war ','bitcoin','btc','ethereum','eth','crypto','gta','album','movie','rihanna','taylor','kanye','carti','playboi','rapper','jesus','christ','alien','hurricane','earthquake','openai','chatgpt','tesla'];
const FUTURES     = ['nba champion','nba mvp','super bowl','nfl champion','world series','mlb champion','stanley cup','nhl champion','win the league','win the pennant','win the season','la liga title','premier league title','bundesliga title','champions league winner','world cup winner','win the world cup','win the fifa','win the copa america','win the euro ','win the euros','win the champions league','ballon d\'or','mvp award','rookie of the year','heisman','golden boot'];
const ESPORTS     = ['counter-strike','cs2','csgo','valorant','dota','league of legends','overwatch','rocket league','fortnite','pubg','esport'];
const PROPS       = ['set winner','game winner','map winner','total games','total sets','total maps','over/','under/','spread','handicap',' ats ','bo3','bo5','best of 3','best of 5','first to','most aces','most kills','player props','anytime scorer','correct score','both teams to score','clean sheet','end in a draw','end in draw','in a draw?','will it be a draw','draw at halftime','draw at half','halftime draw','draw in the','result in a draw','finish in a draw','end as a draw',': draw ',': draw?','draft pick','be the first pick','be the second pick','be the third pick','mock draft',
  'removed from','banned from','suspended from','excluded from','disqualified from',
  'fired from','resign from','retire from','stripped of'];
const SPORTS_CONFIRM = [
  ' vs ',' vs. ',' v ',' v. ',' @ ','win on 20',
  'match winner','match result','moneyline','win the game','win the match',
  'beats ','defeats ','beat ','defeat ',
  'advance to','advance in','to advance',
  'to win the series','win the series',
  'win game ','to win game',
  'game 1','game 2','game 3','game 4','game 5','game 6','game 7',
  'nba','nfl','mlb','nhl','mls','ufc','atp','wta','pga',
  'premier league','la liga','champions league','europa league','conference league',
  'bundesliga','serie a','ligue 1','eredivisie','primeira liga','super lig',
  'ucl ','uefa','cl final','cl quarter','cl semi',
  'ncaa','copa america','wimbledon','us open','french open','australian open','ipl','cricket',
  ' playoff',' playoffs','conference final','semifinal','quarterfinal',
  'celtics','lakers','warriors','nuggets','thunder','timberwolves','cavaliers','knicks','pacers','heat','bucks','76ers',
  'yankees','dodgers','mets','cubs','red sox','astros','braves','padres','phillies','giants','cardinals','diamondbacks','orioles',
  'bruins','maple leafs','rangers','penguins','avalanche','oilers','panthers','lightning','capitals','jets','stars','kings',
];

function classify(m) {
  const text = ((m.question || '') + ' ' + (m.title || '')).toLowerCase();
  // FIX: rechazar mercados cuya fecha de partido ya pasó
  const pastDate = text.match(/win on (\d{4}-\d{2}-\d{2})/);
  if (pastDate && new Date(pastDate[1]) < new Date()) return 'REJECTED:past-game-date';
  if (FUTURES.some(k => text.includes(k)))        return 'REJECTED:futures';
  if (NON_SPORTS.some(k => text.includes(k)))     return 'REJECTED:non-sports';
  if (ESPORTS.some(k => text.includes(k)))        return 'REJECTED:esports';
  if (PROPS.some(k => text.includes(k)))          return 'REJECTED:props';
  if (SPORTS_CONFIRM.some(k => text.includes(k))) return 'ACCEPTED';
  return 'REJECTED:no-keyword';
}

function parseYesPrice(m) {
  if (Array.isArray(m.tokens)) {
    const t = m.tokens.find(t => t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes');
    if (t?.price) return parseFloat(t.price);
  }
  let o = m.outcomes, p = m.outcomePrices;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = []; } }
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = []; } }
  if (Array.isArray(o) && Array.isArray(p)) {
    const idx = o.findIndex(x => (typeof x === 'string' ? x : x?.name || '').toLowerCase() === 'yes');
    if (idx >= 0) return parseFloat(p[idx]) || 0;
  }
  return 0;
}

const SPORT_TAGS = [
  'nba', 'nfl', 'mlb', 'nhl', 'mls', 'ufc', 'tennis',
  'soccer',
  'champions-league', 'europa-league', 'conference-league',
  'premier-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-1',
  'eredivisie', 'primeira-liga', 'super-lig',
  'world-cup', 'copa-america', 'euro-2024',
  'nba-playoffs',
  'cricket', 'rugby',
];

export default async function handler(req, res) {
  try {
    const GAMMA    = 'https://gamma-api.polymarket.com';
    const MIN_VOL  = parseFloat(process.env.MIN_MARKET_VOLUME || '100');
    const MIN_P    = parseFloat(process.env.MIN_YES_PROB || '20');
    const MAX_P    = parseFloat(process.env.MAX_YES_PROB || '80');
    const MAX_DAYS = parseInt(process.env.MAX_DAYS_TO_RESOLVE || '30');

    // Fuente 1: Events por tag_slug (NBA, NHL, MLB, etc.)
    const byTags = await Promise.all(
      SPORT_TAGS.map(tag =>
        fetch(`${GAMMA}/events?active=true&closed=false&tag_slug=${tag}&limit=200`)
          .then(r => r.ok ? r.json() : [])
          .then(data => {
            const events = Array.isArray(data) ? data : (data.data || []);
            return events.flatMap(e => e.markets || [e]);
          })
          .catch(() => [])
      )
    ).then(r => r.flat());

    // Fuente 2: Paginación dual por fecha + volumen
    const [byDate, byVolume] = await Promise.all([
      Promise.all([0,1,2,3,4].map(i =>
        fetch(`${GAMMA}/markets?active=true&closed=false&archived=false&limit=100&offset=${i*100}&order=endDate&ascending=true`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      )).then(b => b.flat()),
      Promise.all([0,1,2].map(i =>
        fetch(`${GAMMA}/markets?active=true&closed=false&archived=false&limit=100&offset=${i*100}&order=volume&ascending=false`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      )).then(b => b.flat()),
    ]);

    // Combinar las tres fuentes, tags primero (mayor prioridad)
    const raw = [...byTags, ...byDate, ...byVolume];
    const seen = new Set();
    const unique = raw.filter(m => {
      const id = m.conditionId || m.condition_id;
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    });

    const analyzed = unique.map(m => {
      const yp  = parseYesPrice(m) * 100;
      const vol = parseFloat(m.volume) || 0;
      let status = classify(m);
      const endDate = m.endDate || m.end_date_iso;
      const diffDays = endDate ? (new Date(endDate) - new Date()) / 86400000 : 999;

      if (status === 'ACCEPTED') {
        if (vol < MIN_VOL)                  status = 'REJECTED:low-volume(' + vol.toFixed(0) + ')';
        else if (yp < MIN_P || yp > MAX_P)  status = 'REJECTED:prob(' + yp.toFixed(0) + '%)';
        else if (diffDays < 0)              status = 'REJECTED:already-ended(' + Math.abs(diffDays).toFixed(0) + 'd ago)';
        else if (diffDays > MAX_DAYS)       status = 'REJECTED:too-far(' + diffDays.toFixed(0) + 'd)';
      }
      return { question: m.question, yesProb: yp.toFixed(1)+'%', volume: vol, endDate, diffDays: diffDays.toFixed(0)+'d', status };
    });

    const summary = analyzed.reduce((a, m) => { a[m.status] = (a[m.status]||0)+1; return a; }, {});
    const aceptados = analyzed.filter(m => m.status === 'ACCEPTED');

    return res.json({
      total_paginados: unique.length,
      fuentes: { por_tags: byTags.length, por_fecha: byDate.length, por_volumen: byVolume.length },
      filtros: { MIN_VOL, MIN_P, MAX_P, MAX_DAYS },
      resumen: summary,
      aceptados_count: aceptados.length,
      aceptados,
      muestra_rechazados_no_keyword: analyzed.filter(m => m.status === 'REJECTED:no-keyword').slice(0,10).map(m => m.question),
      muestra_rechazados_futures: analyzed.filter(m => m.status === 'REJECTED:futures').slice(0,5).map(m => m.question),
      muestra_rechazados_prob: analyzed.filter(m => m.status?.startsWith('REJECTED:prob')).slice(0,5).map(m => ({ q: m.question, p: m.yesProb })),
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
