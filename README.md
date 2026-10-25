# WhatsApp Outreach Agent — Real Estate

An agent that follows up with warm leads over WhatsApp: sends an approved opening
template to everyone pending in the database, then hands the live conversation to
Claude, which qualifies the lead and updates their status as it chats.

## How it fits together

```
Postgres (Neon) — leads + conversations + properties tables
        ▲              ▲
        │ read/write   │ read/write
        │              │
 outreachRunner.js   webhookServer.js  ◄── WhatsApp sends replies here
        │              │      │
        ▼              ▼      ▼
   WhatsApp Cloud API (Meta)   claudeAgent.js ──► Claude API
```

- **`scripts/sendOutreachBatch.js`** — run this (manually or on a schedule) to
  send the first WhatsApp message to every lead with `status = 'pending'` in the
  `leads` table. Must use an approved *template* message — WhatsApp policy, not
  optional.
- **`src/webhookServer.js`** — an always-on server. When a lead replies, WhatsApp
  posts it here; the agent looks up their history, asks Claude what to say, sends
  the reply, and logs everything back to the database.
- **`src/claudeAgent.js`** — the actual "brain": persona, qualification logic, and
  two tools — `update_lead` to keep CRM status current (`in_conversation`,
  `needs_human`, `booked_viewing`, `not_interested`), and `search_properties` to
  look up real listings instead of guessing when a lead asks what's available.
- **`src/dbClient.js`** — all the Postgres queries, in one place.

## What you need before this runs

1. **WhatsApp Cloud API access** for your business number — permanent access
   token, phone number ID, and at least one *approved* message template.
   → `docs/SETUP_META.md`
2. **A Postgres database** with the `leads`, `conversations`, and `properties`
   tables created. → `docs/SETUP_DATABASE.md`, schema in `db/schema.sql`
3. **A place to host the server** so it's reachable 24/7. → `docs/DEPLOYMENT.md`
4. **An Anthropic API key** (you already have this).

## Quick start (local test, before deploying)

```bash
npm install
cp .env.example .env   # fill in every value — see docs/ for how to get each one
npm start               # starts the webhook server AND the test console on localhost:3000
```

Open **http://localhost:3000** for a small built-in test console — a lead
list, a chat view, and buttons to send a real template or freeform WhatsApp
message. To also *receive* replies locally (so Zara auto-replies show up
live), tunnel port 3000 publicly with `ngrok http 3000` and point the Meta
webhook at that URL. Full walkthrough: `docs/TRY_IT_LOCALLY.md`.

`npm run outreach` still runs the batch sender directly from the CLI — the
console above is for one-off testing, not bulk sends.

## Editing how the agent talks

- Tone, goals, and escalation rules: `src/systemPrompt.js`
- Business description shown to the model: `BUSINESS_CONTEXT` in `.env`
- The opening WhatsApp template text: edited in WhatsApp Manager directly (see
  `docs/SETUP_META.md` step 6), name/language referenced via
  `OUTREACH_TEMPLATE_NAME` / `OUTREACH_TEMPLATE_LANG` in `.env`

## Current limitations (MVP, worth knowing)

- No handling for re-engaging a lead after the 24h conversation window closes
  mid-chat (only the very first contact is template-based); a stalled
  conversation just sits in whatever status it was last in until you follow up
  manually.
- Escalation (`needs_human`/`booked_viewing`) only logs to the server console —
  wire up a Slack webhook or email alert in `src/webhookServer.js` (see the
  `TODO` there) so your team actually notices in real time.
- The built-in test console (`public/index.html`, `docs/TRY_IT_LOCALLY.md`) is
  meant for one-off testing and adding a handful of leads by hand, not as a
  real team-facing CRM — for anything beyond a few dozen leads, Neon's own
  table view is still the fastest way to review/bulk-edit data directly.
- I wasn't able to test the database code end-to-end against your actual Neon
  instance — this sandbox can't reach it over the network (see
  `docs/SETUP_DATABASE.md`). It's syntax-checked and the query logic is
  straightforward, but give it a real run once deployed before trusting it with
  live leads.

None of these block getting started; they're the natural next iterations once
the basic loop is working.
