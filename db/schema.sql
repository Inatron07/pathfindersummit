-- Run this once against your Neon database (via Neon's SQL Editor in the
-- console, or `psql "$DATABASE_URL" -f db/schema.sql` from a machine that can
-- reach it) before starting the agent.

CREATE TABLE IF NOT EXISTS leads (
  id                  SERIAL PRIMARY KEY,
  name                TEXT,
  phone               TEXT NOT NULL UNIQUE,   -- digits only, with country code, e.g. 919876543210
  area                TEXT,                   -- locality/area they're interested in
  inquiry_source      TEXT,                   -- e.g. "Site inquiry", "Facebook ad", "Phone call"
  property_interest   TEXT,                   -- e.g. "2BHK, ~90L, ready to move"
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
    -- pending | sent | send_failed | replied | in_conversation
    -- | needs_human | booked_viewing | not_interested
  conversation_stage  TEXT,
  last_contacted      TIMESTAMPTZ,
  last_inbound        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

CREATE TABLE IF NOT EXISTS conversations (
  id          SERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_phone_time ON conversations (phone, created_at);

-- keep updated_at current automatically
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Live inventory the agent can search when a lead asks about specific
-- listings ("what do you have in Whitefield under 90L"). See db/002_properties.sql
-- if you've already run the leads/conversations tables above and just want
-- to add this piece.
CREATE TABLE IF NOT EXISTS properties (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,          -- e.g. "Prestige Lakeside 3BHK"
  area              TEXT NOT NULL,          -- locality, matched against lead interest
  property_type     TEXT,                   -- e.g. "2BHK", "3BHK", "Villa", "Plot", "Office"
  price             NUMERIC,                -- in rupees, e.g. 9000000 for 90L
  bedrooms          INT,
  size_sqft         INT,
  status            TEXT NOT NULL DEFAULT 'available', -- available | sold | rented | on_hold
  description       TEXT,
  listing_url       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_area ON properties (area);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status);

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Example rows (delete or leave — harmless either way):
-- INSERT INTO properties (title, area, property_type, price, bedrooms, size_sqft, description)
-- VALUES ('Prestige Lakeside 3BHK', 'Whitefield', '3BHK', 9500000, 3, 1650, 'Ready to move, lake-facing, gated community');

-- Example lead row (delete or leave — the outreach script only touches
-- status = 'pending' rows, so this one is safe to keep around for testing):
-- INSERT INTO leads (name, phone, area, inquiry_source, property_interest)
-- VALUES ('Test Lead', '910000000000', 'Whitefield', 'Manual test', '2BHK')
-- ON CONFLICT (phone) DO NOTHING;
