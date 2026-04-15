import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INITIAL_BANKROLL = parseFloat(process.env.INITIAL_BANKROLL || '100');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Proteger con CRON_SECRET o DASHBOARD_PASSWORD
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Borrar todas las posiciones
    const { error: posErr } = await supabase
      .from('positions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // borrar todo

    if (posErr) throw new Error(`Error borrando posiciones: ${posErr.message}`);

    // 2. Borrar trades_log
    const { error: logErr } = await supabase
      .from('trades_log')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (logErr) throw new Error(`Error borrando trades_log: ${logErr.message}`);

    // 3. Resetear bankroll
    const { error: bankErr } = await supabase
      .from('bankroll_state')
      .update({
        available_cash: INITIAL_BANKROLL,
        updated_at: new Date().toISOString(),
      })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (bankErr) throw new Error(`Error reseteando bankroll: ${bankErr.message}`);

    return res.json({
      status: 'ok',
      message: `Bankroll reseteado a $${INITIAL_BANKROLL}. Todas las posiciones eliminadas.`,
      initialBankroll: INITIAL_BANKROLL,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
