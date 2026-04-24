const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function groqHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
  };
}

// ─────────────────────────────────────────────
// AGENTE 1 — Análisis deportivo
// Decide si hay edge entre la estimación propia
// y la probabilidad implícita del mercado
// ─────────────────────────────────────────────
export async function analyzeMarket(market, context = null) {
  const hasContext = !!context;

  // Sin contexto Tavily: instrucciones diferentes — el agente debe basarse en la
  // probabilidad implícita y conocimiento previo, siendo menos conservador.
  const contextSection = hasContext
    ? `\n## CONTEXTO ACTUAL (noticias y datos recientes)\n${context}\n`
    : `\n## NOTA: No hay contexto externo disponible para este partido.\nDebes basarte en la probabilidad implícita del mercado y tu conocimiento previo del deporte.\nSi el mercado está en un rango de 35-65%, asume que es relativamente parejo y apostar por el lado más probable tiene sentido.\nSolo marca SKIP=true si hay razones claras para no apostar (mercado muy desequilibrado, pregunta confusa, liga totalmente desconocida).\n`;

  const marketType = market.question.toLowerCase().includes('end in a draw') ? 'DRAW'
    : market.question.toLowerCase().includes('advance') ? 'ADVANCE'
    : market.question.toLowerCase().includes('win the series') ? 'SERIES'
    : 'MATCH_WINNER';

  const prompt = `
Eres un analista deportivo experto. Evalúa esta apuesta en Polymarket:

Pregunta: ${market.question}
Tipo de mercado: ${marketType}
Probabilidad implícita YES: ${market.yesProb.toFixed(1)}%
Volumen: $${market.volume}
Cierre: ${market.endDate}
Deporte: ${market.sport || 'desconocido'}
${contextSection}
## TU TRABAJO
Decide si apostar YES o NO y si hay edge real (tu estimación vs mercado).

## REGLAS ESTRICTAS
1. SKIP=true OBLIGATORIO si:
   - El mercado es un EMPATE (draw) — son impredecibles, no apostar
   - La liga es completamente desconocida o de nivel muy bajo
   - La pregunta es sobre draft picks, premios individuales o eventos no deportivos
2. SKIP=false si: el mercado es sobre GANADOR DE PARTIDO o AVANCE en eliminatoria
   en una liga conocida (NBA, NFL, MLB, NHL, Premier League, La Liga, Serie A, Bundesliga, MLS, UFC, etc.)
3. Para mercados MATCH_WINNER o ADVANCE en ligas conocidas:
   - Favorito (YES > 55%): considera apostar YES si el favorito es claro
   - Underdog (YES < 45%): considera apostar YES si ves valor real, NO si el favorito es obvio
   - VALUE=LOW es aceptable — no saltes solo por edge pequeño
4. REC_PROB debe ser tu estimación real, no simplemente el precio del mercado

Responde EXACTAMENTE en este formato, sin texto adicional:
REC_SIDE: YES o NO
REC_TEAM: [nombre del equipo/lado ganador según tu análisis, o NO_BET]
REC_PROB: [tu estimación % como entero, ej: 62]
VALUE: HIGH, MEDIUM, LOW o NONE
SKIP: true o false
`.trim();

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: groqHeaders(),
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 150,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Agente1 error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  const text = data.choices[0].message.content;

  return {
    recSide: text.match(/REC_SIDE:\s*(\w+)/)?.[1]?.toUpperCase() || 'NO',
    recTeam: text.match(/REC_TEAM:\s*(.+)/)?.[1]?.trim() || 'NO_BET',
    recProb: parseFloat(text.match(/REC_PROB:\s*([\d.]+)/)?.[1] || 0),
    value: text.match(/VALUE:\s*(\w+)/)?.[1]?.toUpperCase() || 'NONE',
    skip: text.match(/SKIP:\s*(\w+)/)?.[1]?.toLowerCase() === 'true',
    raw: text,
  };
}

// ─────────────────────────────────────────────
// AGENTE 2 — Bankroll manager
// Recibe la decisión ya aprobada del Agente 1
// y determina el monto de stake
// ─────────────────────────────────────────────
export async function getBankrollStake({ market, analysis, bankroll }) {
  const { availableCash, initialBankroll, openPositionsCount, openExposure } = bankroll;

  const vsParts = market.question.split(' vs ').map(s => s.trim());
  const teamA = vsParts[0] || market.question;
  const teamB = vsParts[1] || 'N/A';

  const confidence =
    market.volume > 10000 ? 'HIGH' :
    market.volume > 1000  ? 'MEDIUM' : 'LOW';

  const prompt = [
    'Eres un gestor de bankroll ultracorto para autopilot paper trading.',
    'Ya existe una decision deportiva previa favorable y NO puedes convertirla en SKIP.',
    'No debes hacer all-in.',
    'Debes tratar el bankroll como un presupuesto total para repartir entre muchas apuestas futuras.',
    'Tu objetivo es maximizar la cantidad de apuestas viables y la calidad del despliegue del capital.',
    'Si el edge es muy fuerte puedes sugerir algo mas alto, pero normalmente debes preservar capital.',
    'Una oportunidad con confianza MEDIUM y tesis razonable si puede merecer stake pequeno o medio.',
    'Tu unico trabajo es elegir el monto prudente de stake para esta entrada ya aprobada.',
    '',
    '## CONTEXTO',
    `Cash disponible: $${availableCash.toFixed(2)}`,
    `Bankroll inicial: $${initialBankroll.toFixed(2)}`,
    `Posiciones abiertas: ${openPositionsCount}`,
    `Exposicion abierta: $${openExposure.toFixed(2)}`,
    `Partido: ${teamA} vs ${teamB}`,
    `Prediccion: ${analysis.recSide} / ${analysis.recTeam} / ${analysis.recProb}%`,
    `Confianza: ${confidence}`,
    `Value: ${analysis.value}`,
    '',
    '## GUIA DE SIZING',
    '- Stakes pequenos tipicos: 1-2 USD para edges modestos o dudas.',
    '- Stakes medios tipicos: 3-5 USD para buenas oportunidades.',
    '- Stakes altos tipicos: 6-10 USD solo si la conviccion es excepcional.',
    '- Si la confianza es MEDIUM pero la idea sigue siendo jugable, prioriza stakes pequenos.',
    '- Si el cash disponible es menor a 1 USD, no hay stake posible.',
    '- Evita recomendar un stake que deje la cartera demasiado seca.',
    '',
    '## REGLA DE RESPUESTA',
    'Responde exactamente con este formato, sin texto adicional:',
    '**STAKE_USD:** [numero con 0-2 decimales, entre 1 y cash disponible]',
    '**RAZON:** [1 oracion corta]',
  ].join('\n');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: groqHeaders(),
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 100,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Agente2 error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  const text = data.choices[0].message.content;

  const stakeMatch = text.match(/\*\*STAKE_USD:\*\*\s*([\d.]+)/);
  const razonMatch = text.match(/\*\*RAZON:\*\*\s*(.+)/);

  // Fallback defensivo si el parseo falla
  const stakeUsd = stakeMatch
    ? Math.min(parseFloat(stakeMatch[1]), availableCash)
    : 1.00;

  return {
    stakeUsd,
    reason: razonMatch?.[1]?.trim() || 'Stake mínimo por fallo de parseo',
    parseOk: !!stakeMatch,
    raw: text,
  };
}
