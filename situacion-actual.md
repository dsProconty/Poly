# Situación Actual — Polymarket Paper Bot

> Documento generado el 2026-04-15 para continuar el desarrollo en una nueva sesión de IA.
> Todo el código vive en: **rama `claude/continue-previous-plan-3Zsrp`** del repositorio `dsproconty/poly`.

---

## ¿Qué es el sistema?

Bot de **paper trading automatizado** para Polymarket. No opera con dinero real.

1. Cada X horas busca mercados deportivos activos en Polymarket
2. Usa dos agentes Groq/Llama-3.3-70b para evaluar si hay "edge"
3. Si hay valor, registra una apuesta simulada en Supabase
4. Un segundo proceso cierra las posiciones cuando el mercado resuelve y calcula PnL

**Objetivo final:** el bot debe encontrar partidos reales y próximos (NBA playoffs, MLB, NHL, etc.) como los que aparecen en dashboards de bots de amigos, tipo:
- "Arizona Diamondbacks vs Baltimore Orioles"
- "Miami Heat vs Boston Celtics"
- "Washington Capitals vs Columbus Blue Jackets"

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend / API | Next.js 16.2.3 (Pages Router), Vercel |
| Base de datos | Supabase (PostgreSQL) |
| IA | Groq — `llama-3.3-70b-versatile` (2 agentes) |
| Búsqueda contextual | Tavily API |
| Datos de mercados | Polymarket Gamma API + CLOB API |
| Autenticación | HMAC cookie (DASHBOARD_PASSWORD) + CRON_SECRET |

---

## Estructura de archivos relevantes

```
lib/
  polymarket.js         → Obtiene mercados de Polymarket (Gamma + Gateway APIs)
  agents.js             → Agente 1 (análisis deportivo) + Agente 2 (bankroll)
  search.js             → Búsqueda Tavily estructurada por deporte
  runBot.js             → Orquesta una corrida completa del bot
  resolvePositions.js   → Cierra posiciones resueltas y calcula PnL

pages/
  index.js              → Dashboard UI (React, Tailwind)
  login.js              → Página de login
  api/
    auth.js             → Login/logout + isValidSession()
    status.js           → Devuelve bankroll + posiciones al dashboard
    trigger.js          → El dashboard llama esto (Run Bot / Resolve)
    run-bot.js          → Endpoint cron para ejecutar el bot
    resolve-positions.js→ Endpoint cron para cerrar posiciones
    reset.js            → Limpia todas las posiciones y resetea bankroll
    debug-markets.js    → Diagnóstico: muestra qué mercados pasan/fallan los filtros

supabase/
  schema.sql            → DDL: bankroll_state, positions, trades_log

vercel.json             → Configuración de despliegue (crons vacíos — ver problema #5)
.env.local.example      → Plantilla de variables de entorno
```

---

## Tablas Supabase

### `bankroll_state` (una sola fila)
| Columna | Tipo | Descripción |
|---|---|---|
| id | uuid | PK |
| available_cash | numeric | Dinero disponible para apostar |
| initial_bankroll | numeric | Bankroll inicial (referencia) |
| updated_at | timestamptz | Última modificación |

### `positions`
| Columna | Descripción |
|---|---|
| market_id | condition_id del mercado en Polymarket |
| question | Texto del mercado |
| team_a / team_b | Equipos extraídos de la pregunta |
| rec_side | Lado apostado (YES/NO) |
| rec_prob | Probabilidad estimada por el agente (%) |
| market_prob | Probabilidad implícita del mercado al apostar (%) |
| stake_usd | Monto apostado |
| status | open / closed |
| outcome | win / loss (solo cuando cerrado) |
| pnl | Ganancia/pérdida en USD |

### `trades_log`
Respuestas raw de los agentes por cada apuesta.

---

## Variables de entorno requeridas

```ini
GROQ_API_KEY=...                          # console.groq.com
TAVILY_API_KEY=tvly-...                   # tavily.com (1000 búsquedas/mes gratis)
NEXT_PUBLIC_SUPABASE_URL=https://...      # Supabase → Project Settings → API
SUPABASE_SERVICE_ROLE_KEY=...            # Supabase → Project Settings → API (service_role)
DASHBOARD_PASSWORD=...                   # Contraseña del dashboard web
CRON_SECRET=...                          # Protege /api/run-bot y /api/resolve-positions

# Parámetros del bot (ajustables)
MIN_MARKET_VOLUME=100                    # Volumen mínimo del mercado en USD
MIN_YES_PROB=20                          # Prob mínima YES para considerar el mercado
MAX_YES_PROB=80                          # Prob máxima YES
MAX_DAYS_TO_RESOLVE=30                   # Días máximos hasta que resuelve el mercado
MAX_MARKETS_PER_RUN=3                    # Mercados evaluados por corrida
INITIAL_BANKROLL=100                     # Bankroll inicial al hacer reset
```

---

## Problemas identificados y estado actual

### Problema 1 — Descubrimiento de mercados (PRINCIPAL, PARCIALMENTE RESUELTO)

**Síntoma:** El bot solo encuentra 1-2 mercados deportivos por corrida, y son partidos de ligas oscuras (fútbol africano/colombiano de febrero que siguen sin resolverse), en lugar de partidos actuales de NBA, MLB, NHL.

**Causa raíz:** La Gamma API ordenada por `endDate ascending` devuelve primero mercados antiguos sin resolver (de febrero, marzo) que están próximos a su fecha límite. Los mercados populares de NBA/MLB/NHL tienen mayor volumen pero pueden estar enterrados en páginas 4-10 del orden por fecha.

**Lo que ya se implementó (rama `claude/continue-previous-plan-3Zsrp`):**
- Fetch dual: 500 mercados por `endDate` + 300 por `volume desc` → hasta 800 únicos
- Se añadieron nombres de equipos NBA/MLB/NHL a SPORTS_CONFIRM (Celtics, Dodgers, Bruins, etc.)
- Se añadieron patrones: `game 1-7`, `advance to`, `win the series`, `to win game`
- `MAX_DAYS_TO_RESOLVE` subió de 7 a 30 días (default)

**Lo que FALTA validar:** No se ha confirmado aún si con estos cambios el bot ahora encuentra "Heat vs Celtics" o "Diamondbacks vs Orioles". Hay que hacer deploy y llamar a `/api/debug-markets` para ver el nuevo `aceptados_count`.

---

### Problema 2 — Gateway API no funciona

**Síntoma:** `source: "markets_fallback"` en todos los resultados. El bot nunca usa la fuente Gateway.

**Causa:** `gateway.polymarket.com/sports-markets` o bien no existe, devuelve formato inesperado, o requiere autenticación. Está implementado en `lib/polymarket.js::fetchGatewayEvents()` pero siempre retorna `[]` vacío.

**Impacto:** Se pierde una fuente potencial de mercados del día (partidos que empiezan hoy). El código hace fallback a Gamma, que es más genérico.

**Lo que hay que hacer:** Investigar el endpoint correcto de la Gateway API de Polymarket. Puede ser:
- `https://gateway.polymarket.com/sports-markets` (actual — no funciona)
- `https://gamma-api.polymarket.com/events?tag_slug=nba&active=true`
- Otro endpoint del Builder API de Polymarket

---

### Problema 3 — Los cron jobs en Vercel están vacíos

**Síntoma:** El bot nunca corre automáticamente.

**Causa:** `vercel.json` tiene:
```json
{ "crons": [] }
```

No hay crons configurados. El bot solo corre cuando el usuario pulsa "Run Bot" manualmente en el dashboard.

**Lo que hay que hacer:** Configurar los crons en `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/run-bot",            "schedule": "0 */6 * * *" },
    { "path": "/api/resolve-positions",  "schedule": "0 * * * *"   }
  ]
}
```
Y añadir el header `Authorization: Bearer $CRON_SECRET` en las llamadas cron (Vercel lo pasa automáticamente si se configura en el dashboard de Vercel como env var).

**Importante:** En Vercel Hobby, los cron jobs tienen límite de 1 invocación/día. En Vercel Pro, funcionan con la frecuencia indicada. Si el usuario está en plan Hobby, los crons no correrán con la frecuencia deseada.

---

### Problema 4 — El Agente 1 a veces salta mercados válidos (VALUE=LOW)

**Síntoma:** En el log de `run-bot` aparece `action: "SKIP", reason: "Agente1: VALUE=LOW"` incluso para mercados que parecen válidos.

**Causa:** El prompt del Agente 1 en `lib/agents.js` evalúa si hay "edge". Si el mercado no tiene mucho contexto (Tavily no encontró información relevante), el agente es conservador y marca VALUE=LOW o NONE.

**Impacto parcial:** Es comportamiento deseable no apostar sin contexto. Pero si Tavily no tiene datos de ligas oscuras y el agente siempre salta, el bot nunca apuesta.

**Posible mejora:** Si no hay contexto Tavily disponible, el agente debería basarse solo en la probabilidad implícita del mercado y ser menos conservador. O usar un modelo más capaz (claude-3-5-haiku via API Anthropic) para mejor razonamiento deportivo.

---

### Problema 5 — Keyword filter rechaza mercados reales de Polymarket

**Síntoma histórico (ya parcialmente resuelto):** Mercados como "Southern Miss Golden Eagles vs. Prairie View A&M Panthers" eran rechazados como `REJECTED:no-keyword`.

**Causa:** Polymarket usa formato `"vs."` (con punto) para muchos partidos americanos, y el filtro solo tenía `' vs '` (sin punto). Corregido añadiendo `' vs. '`.

**Estado:** Fix aplicado y en producción (main branch). Aún puede haber formatos no cubiertos.

---

### Problema 6 — Mercados de febrero/marzo sin resolver contaminan resultados

**Síntoma:** El bot encuentra "Will Olympic Dcheira win on 2026-02-02?" (fecha ya pasada) porque Polymarket todavía no ha resuelto ese mercado y su `endDate` cae dentro de la ventana de 30 días.

**Causa:** Algunos operadores/oráculos tardan semanas/meses en resolver mercados de ligas oscuras. El campo `endDate` de la API es la fecha límite de resolución (no la fecha del partido).

**Impacto:** El bot puede apostar en partidos que ya terminaron y cuyo resultado se desconoce.

**Lo que hay que hacer:** Filtrar mercados cuyo texto de pregunta contenga una fecha ya pasada. Por ejemplo, si la pregunta dice `"win on 2026-02-02"` y esa fecha es anterior a hoy, rechazarlo.

Implementación sugerida en `lib/polymarket.js::isRealSportsMatch()`:
```js
// Rechazar si la fecha explícita en la pregunta ya pasó
const dateInQuestion = text.match(/win on (\d{4}-\d{2}-\d{2})/);
if (dateInQuestion) {
  const gameDate = new Date(dateInQuestion[1]);
  if (gameDate < new Date()) return false;
}
```

---

### Problema 7 — Timeout en Vercel Hobby (10 segundos)

**Síntoma potencial:** Con `MAX_MARKETS_PER_RUN=3`, cada mercado requiere Tavily (~1-2s) + Groq Agente1 (~1-2s) + Groq Agente2 (~1-2s) = ~4-6s por mercado. 3 mercados = 12-18s → timeout en plan Hobby.

**Mitigation actual:** El endpoint del dashboard usa `/api/trigger` que llama la lógica directamente (sin sub-requests HTTP). Pero el timeout de 10s sigue siendo el límite.

**Solución:** Si está en plan Hobby, configurar `MAX_MARKETS_PER_RUN=1` en las env vars de Vercel. Si está en Pro, puede subir a 3-5.

---

## Estado de la rama `claude/continue-previous-plan-3Zsrp`

Esta rama contiene todos los fixes de `main` más los últimos cambios. Para hacer merge a main (para que Vercel lo desplegue), el proceso es:

```bash
git checkout main
git merge claude/continue-previous-plan-3Zsrp
git push origin main
```

### Commits clave en esta rama (sobre main):
1. `f7c49ee` — Auth en `/api/trigger` y `/api/status` (session cookie)
2. `6a32f22` — Dual fetch por fecha+volumen, más keywords, MAX_DAYS=30, MAX_MARKETS=3

---

## Lo que está funcionando correctamente ✅

- [x] Dashboard web con bankroll, posiciones abiertas, posiciones cerradas
- [x] Login con contraseña + cookie HMAC segura
- [x] Botón "Run Bot" ejecuta el bot manualmente
- [x] Botón "Resolve" cierra posiciones resueltas
- [x] Botón "Reset" limpia todo y restaura bankroll a $100
- [x] `/api/reset` acepta tanto session cookie como CRON_SECRET
- [x] PnL calculado con odds reales (1/p - 1) × stake
- [x] Búsqueda Tavily estructurada por deporte (NBA, soccer, MMA, tenis...)
- [x] Agente 1 analiza mercado y decide YES/NO/SKIP
- [x] Agente 2 calcula stake según bankroll disponible y confianza
- [x] Prevención de apuestas duplicadas en el mismo mercado
- [x] Filtros keyword: blocklist FUTURES, NON_SPORTS, ESPORTS, PROPS + allowlist SPORTS_CONFIRM
- [x] Build Next.js sin errores

---

## Expectativa de resultado final

El bot debe funcionar de manera **completamente autónoma**:

1. **Cada 6 horas**, Vercel ejecuta `/api/run-bot`
2. El bot analiza los mercados deportivos activos de Polymarket
3. Identifica **partidos reales y próximos** como:
   - NBA Playoffs: "Boston Celtics vs Miami Heat" (Game 3, resuelve en 24h)
   - MLB: "Arizona Diamondbacks vs Baltimore Orioles"
   - NHL Playoffs: "Washington Capitals vs Columbus Blue Jackets"
4. Los agentes de IA buscan contexto (últimos resultados, lesiones) y evalúan edge
5. Si hay valor, coloca una apuesta simulada (típicamente $3-$10 de los $100 de bankroll)
6. **Cada hora**, Vercel ejecuta `/api/resolve-positions`
7. Los partidos que ya terminaron cierran la posición con WIN/LOSS y ajustan el bankroll
8. El dashboard muestra en tiempo real el rendimiento del bot

### Métricas de éxito
- `mercadosDisponibles >= 10` por corrida (actualmente: 2)
- Al menos 80% de los mercados son de ligas principales (NBA, MLB, NHL, EPL, NFL)
- El bot coloca al menos 1 apuesta por corrida cuando hay bankroll disponible
- Las posiciones se cierran automáticamente en menos de 48h tras el partido

---

## Pasos inmediatos recomendados para la próxima sesión

### Prioridad 1 — Verificar el fix de descubrimiento
```bash
# Después de hacer deploy de la rama claude/continue-previous-plan-3Zsrp:
curl https://[tu-dominio].vercel.app/api/debug-markets
# Verificar que aceptados_count >= 10 y que incluye NBA/MLB/NHL
```

### Prioridad 2 — Filtrar mercados con fecha pasada en la pregunta
En `lib/polymarket.js`, función `isRealSportsMatch()`, añadir al principio:
```js
// Rechazar mercados cuya fecha de partido ya pasó
const pastDate = text.match(/win on (\d{4}-\d{2}-\d{2})/);
if (pastDate && new Date(pastDate[1]) < new Date()) return false;
```

### Prioridad 3 — Investigar Gateway API
Probar directamente:
```bash
curl https://gateway.polymarket.com/sports-markets?active=true
curl https://gamma-api.polymarket.com/events?tag_slug=nba&active=true&closed=false&limit=20
```
Si el segundo funciona, actualizar `fetchGatewayEvents()` para usar `/events` con sport tags.

### Prioridad 4 — Configurar cron jobs
Actualizar `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/run-bot",           "schedule": "0 */6 * * *" },
    { "path": "/api/resolve-positions", "schedule": "0 * * * *"   }
  ]
}
```

### Prioridad 5 — Merge a main y redeploy
```bash
git checkout main
git merge claude/continue-previous-plan-3Zsrp
git push origin main
```

---

## Notas para el modelo que continúe este trabajo

- El proyecto usa **Next.js Pages Router** (no App Router). Las API routes están en `pages/api/`.
- Los agentes usan **Groq** (no OpenAI). El cliente es un `fetch` directo a `https://api.groq.com/openai/v1/chat/completions`.
- La Gamma API de Polymarket **ignora completamente el parámetro `tag_slug`** en el endpoint `/markets`. Se probó y devuelve elecciones de Guinea-Bisáu aunque se pida `tag_slug=sports`. Por eso se filtra 100% por keywords después de traer 800 mercados genéricos.
- El campo `endDate` de los mercados en Gamma API es la **fecha límite de resolución** del mercado, NO la fecha del partido. Una apuesta "Will X win on 2026-02-02?" puede tener `endDate = 2026-04-20` si el oráculo tardó en resolver.
- `vercel.json` tiene `"crons": []` — los crons NO están activos actualmente.
- La rama de desarrollo es `claude/continue-previous-plan-3Zsrp`. La rama `main` está 2 commits detrás (no tiene el dual-fetch fix).
