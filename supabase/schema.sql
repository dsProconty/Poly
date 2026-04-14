-- Polymarket Paper Bot — Supabase Schema
-- Ejecutar en: Supabase Dashboard → SQL Editor

-- 1. Bankroll state (una sola fila)
CREATE TABLE IF NOT EXISTS bankroll_state (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  available_cash   numeric(10,2) NOT NULL DEFAULT 100.00,
  initial_bankroll numeric(10,2) NOT NULL DEFAULT 100.00,
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- Seed inicial (editar el monto según tu bankroll de prueba)
INSERT INTO bankroll_state (available_cash, initial_bankroll)
VALUES (100.00, 100.00);

-- 2. Positions (apuestas en papel)
CREATE TABLE IF NOT EXISTS positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       text          NOT NULL,
  question        text          NOT NULL,
  team_a          text,
  team_b          text,
  rec_side        text,                    -- 'YES' | 'NO'
  rec_team        text,
  rec_prob        numeric(5,2),            -- estimación del agente 0-100
  market_prob     numeric(5,2),            -- probabilidad implícita al momento de la apuesta
  stake_usd       numeric(10,2) NOT NULL,
  bankroll_reason text,
  status          text          NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'closed')),
  outcome         text
                  CHECK (outcome IN ('win', 'loss')),
  pnl             numeric(10,2),
  closed_at       timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS positions_status_idx    ON positions (status);
CREATE INDEX IF NOT EXISTS positions_market_id_idx ON positions (market_id);

-- 3. Trades log (respuestas raw de los agentes)
CREATE TABLE IF NOT EXISTS trades_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id       uuid REFERENCES positions (id) ON DELETE CASCADE,
  agent1_response   text,
  bankroll_response text,
  stake_usd         numeric(10,2),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trades_log_position_idx ON trades_log (position_id);
