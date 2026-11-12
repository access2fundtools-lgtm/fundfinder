-- OneUp Academy — push notifications (run after 001_academy.sql)
CREATE TABLE IF NOT EXISTS academy.push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT,
  auth        TEXT,
  member_id   BIGINT REFERENCES academy.members(id),
  city_state  TEXT,
  track       TEXT,
  user_agent  TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS academy.notifications (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  url         TEXT NOT NULL DEFAULT '/',
  target      TEXT NOT NULL DEFAULT 'all',   -- all | city | track
  target_value TEXT,
  sent_count  INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE academy.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy.notifications      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA academy FROM anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA academy TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA academy TO service_role;
