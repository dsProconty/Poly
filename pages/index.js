import { useState, useEffect, useCallback } from 'react';
import { isValidSession } from './api/auth';

export async function getServerSideProps({ req }) {
  if (!isValidSession(req)) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: {} };
}

const fmt = (n) =>
  n == null ? '—' : `$${parseFloat(n).toFixed(2)}`;

const pct = (n) =>
  n == null ? '—' : `${parseFloat(n).toFixed(1)}%`;

function Badge({ value }) {
  if (value === 'open')
    return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-yellow-400/10 text-yellow-300 border border-yellow-400/30">OPEN</span>;
  if (value === 'win')
    return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-400/10 text-green-400 border border-green-400/30">WIN</span>;
  if (value === 'loss')
    return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-400/10 text-red-400 border border-red-400/30">LOSS</span>;
  return <span className="px-2 py-0.5 rounded text-xs text-zinc-500">{value}</span>;
}

function SideBadge({ side }) {
  if (side === 'YES')
    return <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">YES</span>;
  return <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">NO</span>;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-zinc-500">{label}</span>
      <span className={`text-2xl font-bold font-mono ${accent || 'text-white'}`}>{value}</span>
      {sub && <span className="text-xs text-zinc-600">{sub}</span>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLog, setActionLog] = useState(null);
  const [running, setRunning] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 30000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  async function runAction(action, label) {
    setRunning(label);
    setActionLog(null);
    try {
      const res = await fetch(`/api/trigger?action=${action}`, { method: 'POST' });
      const json = await res.json();
      setActionLog({ label, ok: res.ok, data: json });
      await fetchStatus();
    } catch (err) {
      setActionLog({ label, ok: false, data: { error: err.message } });
    } finally {
      setRunning(null);
    }
  }

  const bankroll = data?.bankroll;
  const open = data?.openPositions || [];
  const closed = data?.closedPositions || [];

  const openExposure = open.reduce((s, p) => s + parseFloat(p.stake_usd || 0), 0);
  const totalPnl = closed.reduce((s, p) => s + parseFloat(p.pnl || 0), 0);
  const wins = closed.filter(p => p.outcome === 'win').length;
  const losses = closed.filter(p => p.outcome === 'loss').length;
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : null;

  return (
    <div
      className="min-h-screen bg-zinc-950 text-zinc-100"
      style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}
    >
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm font-semibold tracking-widest uppercase text-zinc-300">
            Polymarket Paper Bot
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchStatus}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-3 py-1.5 border border-zinc-800 rounded hover:border-zinc-600"
          >
            ↻ Refresh
          </button>
          <button
            onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); window.location.href = '/login'; }}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors px-3 py-1.5 border border-zinc-800 rounded hover:border-zinc-700"
          >
            Salir
          </button>
          <button
            onClick={() => runAction('run-bot', 'run-bot')}
            disabled={!!running}
            className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded font-semibold transition-colors"
          >
            {running === 'run-bot' ? '⏳ Running…' : '▶ Run Bot'}
          </button>
          <button
            onClick={() => runAction('resolve', 'resolve')}
            disabled={!!running}
            className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded font-semibold transition-colors"
          >
            {running === 'resolve' ? '⏳ Resolving…' : '✓ Resolve'}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Error banner */}
        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-5 py-3 text-sm text-red-400">
            Error cargando datos: {error}
          </div>
        )}

        {/* Action log */}
        {actionLog && (
          <div className={`border rounded-lg px-5 py-3 text-xs ${actionLog.ok ? 'bg-emerald-900/10 border-emerald-700/30 text-emerald-300' : 'bg-red-900/10 border-red-700/30 text-red-400'}`}>
            <span className="font-bold uppercase">{actionLog.label}</span>
            <pre className="mt-1 whitespace-pre-wrap text-zinc-400 text-xs">
              {JSON.stringify(actionLog.data, null, 2)}
            </pre>
          </div>
        )}

        {/* Bankroll stats */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 h-20 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Saldo Disponible"
              value={fmt(bankroll?.available_cash)}
              sub={`Inicial: ${fmt(bankroll?.initial_bankroll)}`}
              accent={parseFloat(bankroll?.available_cash) >= parseFloat(bankroll?.initial_bankroll) ? 'text-emerald-400' : 'text-rose-400'}
            />
            <StatCard
              label="Dinero en Juego"
              value={fmt(openExposure)}
              sub={`${open.length} apuesta${open.length !== 1 ? 's' : ''} activa${open.length !== 1 ? 's' : ''}`}
              accent="text-yellow-300"
            />
            <StatCard
              label="Ganancia / Pérdida"
              value={fmt(totalPnl)}
              sub={`${wins} ganadas / ${losses} perdidas`}
              accent={totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            />
            <StatCard
              label="Tasa de Acierto"
              value={winRate != null ? `${winRate}%` : '—'}
              sub={`${wins + losses} apuestas cerradas`}
              accent="text-zinc-200"
            />
          </div>
        )}

        {/* Open positions */}
        <section>
          <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
            Posiciones Abiertas ({open.length})
          </h2>
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            {open.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-600 text-sm">Sin posiciones abiertas</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3 font-medium">Partido</th>
                    <th className="text-left px-4 py-3 font-medium">Apuesta</th>
                    <th className="text-right px-4 py-3 font-medium">Monto</th>
                    <th className="text-right px-4 py-3 font-medium">Prob. Mercado</th>
                    <th className="text-right px-4 py-3 font-medium">Prob. Agente</th>
                    <th className="text-left px-4 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((p, i) => (
                    <tr key={p.id} className={`border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors ${i === open.length - 1 ? 'border-b-0' : ''}`}>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="truncate text-zinc-200">{p.question}</div>
                        <div className="text-xs text-zinc-600 truncate">{p.market_id?.slice(0, 16)}…</div>
                      </td>
                      <td className="px-4 py-3"><SideBadge side={p.rec_side} /></td>
                      <td className="px-4 py-3 text-right text-zinc-200">{fmt(p.stake_usd)}</td>
                      <td className="px-4 py-3 text-right text-zinc-400">{pct(p.market_prob)}</td>
                      <td className="px-4 py-3 text-right text-zinc-200">{pct(p.rec_prob)}</td>
                      <td className="px-4 py-3"><Badge value={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Closed positions */}
        <section>
          <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3">
            Últimas Cerradas ({closed.length})
          </h2>
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            {closed.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-600 text-sm">Sin posiciones cerradas aún</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                    <th className="text-left px-4 py-3 font-medium">Partido</th>
                    <th className="text-left px-4 py-3 font-medium">Apuesta</th>
                    <th className="text-right px-4 py-3 font-medium">Monto</th>
                    <th className="text-right px-4 py-3 font-medium">Ganancia/Pérdida</th>
                    <th className="text-left px-4 py-3 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((p, i) => (
                    <tr key={p.id} className={`border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors ${i === closed.length - 1 ? 'border-b-0' : ''}`}>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="truncate text-zinc-200">{p.question}</div>
                      </td>
                      <td className="px-4 py-3"><SideBadge side={p.rec_side} /></td>
                      <td className="px-4 py-3 text-right text-zinc-400">{fmt(p.stake_usd)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${parseFloat(p.pnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {parseFloat(p.pnl) >= 0 ? '+' : ''}{fmt(p.pnl)}
                      </td>
                      <td className="px-4 py-3"><Badge value={p.outcome} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

      </main>

      <footer className="border-t border-zinc-900 px-6 py-4 text-center text-xs text-zinc-700">
        Paper trading — no real money involved · Auto-refresh cada 30s
      </footer>
    </div>
  );
}
