-- Incremental migration: only the `properties` table, for anyone who already
-- ran the original db/schema.sql (leads + conversations) and just wants to
-- add this piece. Safe to run even if you re-run the full schema.sql instead —
-- everything here uses IF NOT EXISTS / OR REPLACE.

CREATE TABLE IF NOT EXISTS properties (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  area              TEXT NOT NULL,
  property_type     TEXT,
  price             NUMERIC,
  bedrooms          INT,
  size_sqft         INT,
  status            TEXT NOT NULL DEFAULT 'available',
  description       TEXT,
  listing_url       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_area ON properties (area);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_updated_at ON properties;
CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
