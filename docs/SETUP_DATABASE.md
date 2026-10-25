# Setting up the database (Neon Postgres)

The agent stores leads, the full conversation transcript, and now a searchable
property listings table, all in Postgres — no spreadsheet involved. This doc
covers creating the schema and how you'll load data in.

## 1. Run the schema

I could not run this for you directly: this sandboxed environment's outbound
network is restricted to an allowlist of domains, and Neon's host isn't on it
(confirmed — DNS resolves fine, but the TCP connection to port 5432 times out).
That's a property of where I'm running, not of your database or connection
string, and it isn't a blocker — Neon gives you a browser-based SQL editor that
works from anywhere:

1. Open your project at [console.neon.tech](https://console.neon.tech).
2. Go to **SQL Editor** in the left sidebar.
3. Paste in the contents of `db/schema.sql` and run it. It creates `leads`,
   `conversations`, and `properties`, plus indexes and a trigger that keeps
   `updated_at` current. It's idempotent (`IF NOT EXISTS` everywhere) — safe
   to run again even though you've already created `leads`/`conversations`,
   it'll just add `properties` this time.
   - Already ran the first version and would rather add only what's new?
     `db/002_properties.sql` has just the `properties` table on its own.

Alternatively, from any machine that *does* have normal internet access (your
laptop, or once the agent itself is deployed to Railway/Fly/a VPS — those hosts
have full outbound access, only this sandbox is restricted):
```bash
psql "$DATABASE_URL" -f db/schema.sql
```

## 2. Loading leads

You mentioned you'll share phone numbers and area separately. Once you have a
CSV, the simplest way in is Neon's SQL Editor again:

```sql
INSERT INTO leads (name, phone, area, inquiry_source, property_interest)
VALUES
  ('Anjali Rao', '919876543210', 'Whitefield', 'Site inquiry', '2BHK, ~90L'),
  ('Rahul Mehta', '919812345678', 'HSR Layout', 'Facebook ad', NULL)
ON CONFLICT (phone) DO NOTHING;
```

A few things that matter for the code to work correctly:
- **`phone`**: digits only, with country code, no `+` or spaces — e.g.
  `919876543210` for an Indian mobile number. This has to match the format
  WhatsApp sends inbound numbers in, which the code normalizes to on every
  lookup — but store it clean going in.
- **`phone` is UNIQUE** — inserting the same number twice is a no-op
  (`ON CONFLICT (phone) DO NOTHING`), which prevents accidentally double-messaging
  someone if your source list has duplicates.
- Leave `status` unset — it defaults to `'pending'`, which is what
  `npm run outreach` looks for.

If you'd rather load from a CSV directly instead of hand-writing INSERT
statements, send me the file and I'll turn it into the SQL (or a `\copy`
command) once you have it ready.

## 3. Loading property listings

This is what `search_properties` (the agent's tool for answering "what do you
have in X area") queries. Same pattern:

```sql
INSERT INTO properties (title, area, property_type, price, bedrooms, size_sqft, description, listing_url)
VALUES
  ('Prestige Lakeside 3BHK', 'Whitefield', '3BHK', 9500000, 3, 1650, 'Ready to move, lake-facing, gated community', 'https://...'),
  ('Sobha Elite 2BHK', 'HSR Layout', '2BHK', 7200000, 2, 1100, 'Under construction, possession Dec 2027', NULL);
```

Notes:
- **`price`** is a plain number in rupees (9500000, not "95L" or "₹95,00,000") —
  the agent formats it for the reply itself.
- **`status`** defaults to `'available'`; the search tool only returns
  available ones — set it to `'sold'`/`'rented'`/`'on_hold'` as things move
  instead of deleting rows, so history isn't lost.
- Send me your listings whenever they're ready (spreadsheet, CSV, whatever you
  have) and I'll convert them the same way.

## 4. Wire it into `.env`

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

That's the same connection string format Neon gives you on the project
dashboard. One note on hygiene: since a live credential for this database has
already been typed into this conversation, it's worth rotating the password in
the Neon dashboard once you're done testing (**Settings → Reset password**) —
cheap insurance, not urgent.
