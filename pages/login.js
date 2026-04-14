import { useState } from 'react';
import { useRouter } from 'next/router';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push('/');
    } else {
      setError('Contraseña incorrecta');
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-zinc-950 flex items-center justify-center"
      style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}
    >
      <div className="w-full max-w-sm px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-semibold tracking-widest uppercase text-zinc-300">
            Polymarket Paper Bot
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 space-y-5"
        >
          <div>
            <label className="block text-xs uppercase tracking-widest text-zinc-500 mb-2">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoFocus
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-4 py-3 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500 transition-colors placeholder-zinc-700"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold py-3 rounded transition-colors"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
