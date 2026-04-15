# Polymarket Paper Bot — Estado del Proyecto

## Qué es esto

Bot de paper trading automatizado para Polymarket. Evalúa mercados deportivos activos, usa dos agentes de IA (Groq/Llama) para decidir si hay edge y cuánto apostar, y registra todo en Supabase. Corre en Vercel con cron jobs.

---

## Arquitectura

```
lib/
  polymarket.js        → llama a la CLOB API de Polymarket (fetch nativo)
  agents.js            → Agente 1 (análisis deportivo) + Agente 2 (bankroll), via Groq

pages/api/
  run-bot.js           → evalúa hasta 3 mercados por corrida, coloca apuestas en papel
  resolve-positions.js → revisa posiciones abiertas, cierra las que ya resolvieron

supabase/
  schema.sql           → tablas: bankroll_state, positions, trades_log

polym/                 → archivos fuente originales (no tocar)
```

### Tablas Supabase

| Tabla | Propósito |
|---|---|
| `bankroll_state` | Una sola fila: `available_cash`, `initial_bankroll`, `updated_at` |
| `positions` | Cada apuesta: mercado, equipo, stake, probabilidades, status, pnl |
| `trades_log` | Respuestas raw de los agentes por posición |

### Variables de entorno requeridas

```ini
GROQ_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

### Cron jobs (vercel.json)

| Endpoint | Schedule | Qué hace |
|---|---|---|
| `/api/run-bot` | `0 12 * * *` | 12:00 UTC diario — evalúa mercados y apuesta |
| `/api/resolve-positions` | `0 6 * * *` | 06:00 UTC diario — cierra posiciones resueltas |

> ⚠️ Vercel Hobby plan: máximo 1 ejecución por día por cron job.

---

## Estado actual ✅ En producción

- [x] `package.json` — next@16.2.3 + @supabase/supabase-js, 0 vulnerabilidades
- [x] `next.config.js` — mínimo
- [x] `lib/polymarket.js` — `fetchEventsByTags()` descubre 12,000+ mercados por tag de deporte
- [x] `lib/agents.js` — Agente 1 con prompt mejorado para mercados sin contexto Tavily
- [x] `pages/api/run-bot.js` — evalúa mercados, coloca apuestas, auth por CRON_SECRET
- [x] `pages/api/resolve-positions.js` — cierra posiciones resueltas, auth por CRON_SECRET
- [x] `pages/api/debug-markets.js` — diagnóstico de mercados aceptados/rechazados
- [x] `pages/api/trigger.js` — disparo manual desde dashboard (auth por sesión)
- [x] `pages/api/status.js` — estado del bankroll y posiciones (auth por sesión)
- [x] `pages/api/reset.js` — resetear bankroll y posiciones (auth por CRON_SECRET o sesión)
- [x] `pages/api/auth.js` — login del dashboard (HMAC cookie, DASHBOARD_PASSWORD)
- [x] `pages/index.js` — dashboard UI con posiciones, bankroll, botón Trigger
- [x] `pages/login.js` — página de login
- [x] `supabase/schema.sql` — 3 tablas con índices y constraints
- [x] `vercel.json` — 2 cron jobs (daily, compatible con Hobby plan)
- [x] `.env.local.example` — plantilla completa de variables
- [x] Deploy en producción: **https://poly-sand.vercel.app** (commit `8f0916e`)

### Validación de debug-markets (15 Apr 2026)
```json
{
  "total_paginados": 12112,
  "fuentes": { "por_tags": 12005, "por_fecha": 500, "por_volumen": 300 },
  "aceptados_count": 48
}
```
✅ 48 mercados reales activos (NBA Play-In, MLS, fútbol europeo/asiático)
✅ Sin mercados pasados contaminando resultados
✅ Descubrimiento por tag_slug funcionando (12,005 desde tags)

---

## Próximos pasos

### 1. Probar el bot manualmente
Ir a **https://poly-sand.vercel.app** → login con `DASHBOARD_PASSWORD` → clic en **Trigger Bot**

Respuesta esperada:
```json
{ "status": "ok", "marketsEvaluados": 3, "apuestasColocadas": 1, "cashRestante": 97.5 }
```

### 2. Verificar variables de entorno en Vercel
En Vercel Dashboard → Project `poly` → Settings → Environment Variables, confirmar:
- `GROQ_API_KEY` ✓
- `NEXT_PUBLIC_SUPABASE_URL` ✓
- `SUPABASE_SERVICE_ROLE_KEY` ✓
- `DASHBOARD_PASSWORD` ✓
- `CRON_SECRET` ✓
- `TAVILY_API_KEY` (opcional — el bot funciona sin él, solo hace menos investigación)
- `MAX_DAYS_TO_RESOLVE` = `30` (recomendado, el default es 7)

### 3. Upgrade a Vercel Pro (opcional)
Para habilitar crons más frecuentes (cada 6h para run-bot, cada 1h para resolve-positions).

---

## Ajustes futuros pendientes

| Item | Archivo | Detalle |
|---|---|---|
| MAX_DAYS muy corto | env var | Subir `MAX_DAYS_TO_RESOLVE` de 7 → 30 en Vercel |
| PnL más preciso | `pages/api/resolve-positions.js` | Usar odds reales del CLOB en lugar de simplificados |
| Mercados "no-keyword" | `lib/polymarket.js` | Los "Will Giannis play for X?" no tienen keyword — podrían filtrarse mejor |
| Upgrade crons | `vercel.json` | Con Pro plan: run-bot cada 6h, resolve-positions cada 1h |

---

## Stack

- **Runtime**: Next.js 16 (Pages Router)
- **DB**: Supabase (PostgreSQL)
- **AI**: Groq — `llama-3.3-70b-versatile`
- **Data**: Polymarket CLOB API (`clob.polymarket.com`)
- **Deploy**: Vercel con cron jobs

---

## Website Development Best Practices

*I for Command, *L for Agent

---

## Website Design Recreation

When the user provides a reference image (screenshot) and optionally some CSS classes or style notes:

### Workflow

1. **Generate** a single `index.html` file using Tailwind CSS (via CDN). Include all content inline — no external files unless requested.
2. **Screenshot** the rendered page using Puppeteer (`npx puppeteer screenshot index.html --fullpage` or equivalent). If the page has distinct sections, capture those individually too.
3. **Compare** your screenshot against the reference image. Check for mismatches in:
   - Spacing and padding (measure in px)
   - Font sizes, weights, and line heights
   - Colors (exact hex values)
   - Alignment and positioning
   - Border radii, shadows, and effects
   - Responsive behavior
   - Image/icon sizing and placement
4. **Fix** every mismatch found. Edit the HTML/Tailwind code.
5. **Re-screenshot** and compare again.
6. **Repeat** steps 3–5 until the result is within ~2–3px of the reference everywhere.

Do NOT stop after one pass. Always do at least 2 comparison rounds. Only stop when the user says so or when no visible differences remain.

### Technical Defaults

- Use Tailwind CSS via CDN (`<script src="https://cdn.tailwindcss.com"></script>`)
- Use placeholder images from `https://placehold.co/` when source images aren't provided
- Mobile-first responsive design
- Single `index.html` file unless the user requests otherwise
- Use semantic HTML5 elements (`<header>`, `<main>`, `<section>`, `<footer>`, etc.)
- Include `<meta name="viewport" content="width=device-width, initial-scale=1.0">` always

---

## Website Creation from Scratch

When the user asks to build a new site, landing page, dashboard, or any web interface:

### Design Thinking (Before Coding)

Before writing any code, define:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose a BOLD aesthetic direction — brutally minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful, editorial/magazine, brutalist/raw, art deco, soft/pastel, industrial, etc.
- **Constraints**: Framework, performance targets, accessibility needs.
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

### Frontend Aesthetics Guidelines

- **Typography**: Choose distinctive, characterful fonts. NEVER default to Inter, Roboto, Arial, or generic system fonts. Pair a display font with a refined body font. Use Google Fonts or CDN-hosted fonts.
- **Color & Theme**: Commit to a cohesive palette using CSS variables. Dominant colors with sharp accents > timid, evenly-distributed palettes. Vary between light/dark themes across projects.
- **Motion & Animation**: Prioritize CSS-only animations for HTML projects. Focus on high-impact moments: staggered page-load reveals (`animation-delay`), scroll-triggered effects, and hover states that surprise. One well-orchestrated animation > scattered micro-interactions.
- **Spatial Composition**: Use unexpected layouts. Asymmetry, overlap, diagonal flow, grid-breaking elements. Generous negative space OR controlled density — pick one and commit.
- **Backgrounds & Depth**: Create atmosphere — gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, grain overlays. Never default to plain solid colors.

### What to AVOID (Generic AI Aesthetics)

- Overused font families (Inter, Roboto, Arial, Space Grotesk)
- Purple gradients on white backgrounds
- Predictable card-grid layouts
- Cookie-cutter component patterns
- Converging on the same design choices across different projects

---

## General Development Standards

### File Structure

```
project/
├── index.html          # Main entry point
├── assets/
│   ├── css/            # Custom CSS if needed beyond Tailwind
│   ├── js/             # JavaScript files
│   └── images/         # Local images
└── pages/              # Additional HTML pages if multi-page
```

### Code Quality

- Write semantic, accessible HTML (`alt` attributes, ARIA labels, proper heading hierarchy)
- Use CSS custom properties (`--var`) for colors, spacing, and typography tokens
- Keep JavaScript minimal and vanilla unless a framework is specified
- Inline critical CSS for performance when applicable
- Optimize images: use `loading="lazy"` and appropriate `srcset` for responsive images
- Ensure keyboard navigation works for all interactive elements

### Responsive Design Checklist

- Test at: 320px (mobile), 768px (tablet), 1024px (laptop), 1440px (desktop)
- Use Tailwind breakpoints: `sm:`, `md:`, `lg:`, `xl:`, `2xl:`
- Text should never overflow its container
- Touch targets minimum 44x44px on mobile
- Images and videos should be fluid (`max-width: 100%`)
- Navigation should collapse into hamburger/drawer on mobile

### Performance

- Minimize external dependencies — every CDN link adds latency
- Use system font stacks as fallback: `font-family: 'ChosenFont', system-ui, sans-serif`
- Defer non-critical JavaScript with `defer` or `async`
- Avoid layout shifts: set explicit `width` and `height` on images
- Keep total page weight under 1MB when possible

### Accessibility (a11y)

- Color contrast ratio: minimum 4.5:1 for normal text, 3:1 for large text
- All images must have descriptive `alt` text
- Focus states visible on all interactive elements
- Proper use of landmarks: `<nav>`, `<main>`, `<aside>`, `<footer>`
- Form inputs must have associated `<label>` elements
- Use `prefers-reduced-motion` media query for users who disable animations
- Use `prefers-color-scheme` for automatic dark/light mode when appropriate

---

## Screenshot & Visual QA Workflow

For any visual work, use this loop:

```bash
# Take a full-page screenshot
npx puppeteer screenshot index.html --fullpage

# Take a screenshot at specific viewport width
npx puppeteer screenshot index.html --viewport 375x812  # iPhone
npx puppeteer screenshot index.html --viewport 1440x900 # Desktop
```

### Comparison Checklist

When comparing screenshots against a reference or previous iteration:

1. **Layout**: Are sections, grids, and flex containers aligned correctly?
2. **Typography**: Font size, weight, line-height, letter-spacing match?
3. **Colors**: Background, text, border, shadow colors match exact hex/rgb?
4. **Spacing**: Margins, paddings, gaps between elements consistent?
5. **Components**: Buttons, cards, inputs, navbars match in shape and style?
6. **Images**: Correct aspect ratio, object-fit, border-radius?
7. **Responsive**: Does it hold up at mobile/tablet/desktop widths?
8. **Interactive states**: Hover, focus, active styles look correct?

---

## Useful CDN Resources

```html
<!-- Tailwind CSS -->
<script src="https://cdn.tailwindcss.com"></script>

<!-- Google Fonts (example) -->
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">

<!-- Lucide Icons -->
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>

<!-- Alpine.js (lightweight interactivity) -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>

<!-- GSAP (advanced animations) -->
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js"></script>

<!-- Placeholder images -->
<!-- https://placehold.co/600x400 -->
<!-- https://placehold.co/600x400/EEE/31343C -->
```

---

## Quick Reference Commands

```bash
# Start a local server
npx serve .

# Screenshot with Puppeteer
npx puppeteer screenshot index.html --fullpage

# Format HTML (if prettier is available)
npx prettier --write index.html

# Check accessibility
npx pa11y index.html
```
