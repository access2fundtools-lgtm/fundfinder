-- OneUp Academy — run once in Supabase → SQL Editor. Uses its own schema "academy".
-- After running: Settings → API → "Exposed schemas" → add  academy
CREATE SCHEMA IF NOT EXISTS academy;

CREATE TABLE IF NOT EXISTS academy.members (
  id              BIGSERIAL PRIMARY KEY,
  full_name       TEXT NOT NULL,
  whatsapp        TEXT NOT NULL,
  city_state      TEXT NOT NULL,
  track           TEXT NOT NULL CHECK (track IN ('sell','install','both')),
  selling_now     BOOLEAN NOT NULL DEFAULT FALSE,
  source          TEXT,                       -- ad campaign tag from ?src=
  consent_at      TIMESTAMPTZ NOT NULL,
  consent_version TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','cancelled')),
  reseller_code   TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS members_whatsapp_idx ON academy.members (whatsapp);

CREATE TABLE IF NOT EXISTS academy.payments (
  id              BIGSERIAL PRIMARY KEY,
  member_id       BIGINT NOT NULL REFERENCES academy.members(id),
  reference       TEXT NOT NULL UNIQUE,
  amount_kobo     INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'initialized' CHECK (status IN ('initialized','success','failed')),
  paystack_raw    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

-- Lock down: only the server (service_role key) may read/write. No public access.
ALTER TABLE academy.members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy.payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA academy FROM anon, authenticated;
GRANT USAGE ON SCHEMA academy TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA academy TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA academy TO service_role;
