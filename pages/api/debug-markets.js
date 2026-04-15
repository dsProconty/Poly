/**
 * Debug endpoint — muestra qué mercados trae la API y por qué se rechazan
 * GET /api/debug-markets
 */
export default async function handler(req, res) {
  try {
    const GAMMA = 'https://gamma-api.polymarket.com';

    const SPORT_TAGS = ['nba','nfl','nhl','mlb','soccer','tennis','mma','cricket','ufc','golf','rugby'];

    // Fetch por tags específicos en paralelo
    const batches = await Promise.all(
      SPORT_TAGS.map(tag =>
        fetch(`${GAMMA}/markets?active=true&closed=false&archived=false&tag_slug=${tag}&limit=15&order=endDate&ascending=true`)
          .then(r => r.ok ? r.json() : [])
          .then(arr => arr.map(m => ({ ...m, _tag: tag })))
          .catch(() => [])
      )
    );
    const raw = batches.flat();
    const rawSports = raw; // mismo set para comparar

    const NON_SPORTS = ['invade','invasion','taiwan','ceasefire','election','president','congress','senate','nuclear','war ','legislation','government','treaty','sanctions','referendum','bitcoin','btc','ethereum','eth','crypto','token','nft','coin','stock','nasdaq','interest rate','fed rate','recession','gta','album','movie','film','song','award','oscar','grammy','emmy','box office','rihanna','taylor','kanye','drake','carti','playboi','rapper','singer','actress','actor','jesus','christ','god ','allah','alien','ufo','apocalypse','hurricane','earthquake','tornado','flood','tsunami','iphone','android','openai','chatgpt','tesla','spacex'];
    const FUTURES = ['stanley cup','nba finals','nba champion','super bowl','world series','nhl champion','mlb champion','nfl champion','win the cup','win the title','win the league','win the season','la liga title','premier league title','bundesliga title','champions league winner','world cup winner','mvp award','rookie of the year','cy young','hart trophy','heisman','golden boot'];
    const ESPORTS = ['counter-strike','cs2','csgo','valorant','dota','league of legends','lol ','overwatch','rocket league','fortnite','pubg','esport'];
    const SPORTS_CONFIRM = [' vs ',' v. ',' @ ','match winner','match result','moneyline','win the game','win the match','beats ','defeats ','beat ','defeat ','nba','nfl','mlb','nhl','mls','ufc','atp','wta','pga','premier league','la liga','champions league','europa league','bundesliga','serie a','ligue 1','ncaa','march madness','copa america','wimbledon','us open','french open','australian open','ipl','cricket','nrl','afl',' playoff',' playoffs','conference final','semifinal','quarterfinal'];

    function classify(m) {
      const text = ((m.question || '') + ' ' + (m.title || '')).toLowerCase();
      if (FUTURES.some(k => text.includes(k)))      return 'REJECTED:future';
      if (NON_SPORTS.some(k => text.includes(k)))   return 'REJECTED:non-sports';
      if (ESPORTS.some(k => text.includes(k)))      return 'REJECTED:esports';
      if (SPORTS_CONFIRM.some(k => text.includes(k))) return 'ACCEPTED';
      return 'REJECTED:no-sports-keyword';
    }

    function parseYesPrice(m) {
      if (Array.isArray(m.tokens)) {
        const t = m.tokens.find(t => t.outcome?.toLowerCase() === 'yes' || t.name?.toLowerCase() === 'yes');
        if (t?.price) return parseFloat(t.price);
      }
      let outcomes = m.outcomes, prices = m.outcomePrices;
      if (typeof outcomes === 'string') { try { outcomes = JSON.parse(outcomes); } catch { outcomes = []; } }
      if (typeof prices === 'string') { try { prices = JSON.parse(prices); } catch { prices = []; } }
      if (Array.isArray(outcomes) && Array.isArray(prices)) {
        const idx = outcomes.findIndex(o => (typeof o === 'string' ? o : o?.name || '').toLowerCase() === 'yes');
        if (idx >= 0) return parseFloat(prices[idx]) || 0;
      }
      return 0;
    }

    const analyzed = raw.slice(0, 50).map(m => {
      const yp = parseYesPrice(m) * 100;
      const vol = parseFloat(m.volume) || 0;
      const status = classify(m);
      return { question: m.question, yesProb: yp.toFixed(1)+'%', volume: vol, endDate: m.endDate, status };
    });

    const accepted = analyzed.filter(m => m.status === 'ACCEPTED');
    const rejectedByType = analyzed.reduce((acc, m) => {
      acc[m.status] = (acc[m.status] || 0) + 1;
      return acc;
    }, {});

    const sportsTagSample = rawSports.slice(0, 10).map(m => ({
      question: m.question,
      yesProb: (parseYesPrice(m) * 100).toFixed(1) + '%',
      volume: parseFloat(m.volume) || 0,
      status: classify(m),
    }));

    return res.json({
      sin_tag_total: raw.length,
      con_tag_sports_total: rawSports.length,
      rechazo_por_tipo: rejectedByType,
      aceptados: accepted.length,
      aceptados_lista: accepted,
      con_tag_sports_muestra: sportsTagSample,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
