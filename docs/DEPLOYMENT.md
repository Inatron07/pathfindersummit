# Deploying the agent

The server needs to be reachable at a public HTTPS URL 24/7 (WhatsApp calls your
`/webhook` the instant someone replies), so it can't just run on your laptop.
Three reasonable options, roughly easiest-to-cheapest:

## Option A: Railway (recommended to start)

1. Push this project to a GitHub repo (or use Railway's CLI to deploy a local
   folder directly — `railway up`).
2. On [railway.app](https://railway.app), **New Project → Deploy from GitHub repo**.
3. In the project's **Variables** tab, paste in everything from your `.env` file,
   including `DATABASE_URL`.
4. Railway auto-detects Node and runs `npm start`. Once deployed, it gives you a
   public URL like `https://your-app.up.railway.app` — that's your webhook base
   URL (`https://your-app.up.railway.app/webhook`).
5. Railway no longer has a permanent free tier — expect a small monthly cost
   (a few dollars) for an always-on hobby instance. Worth it: this is the app that
   must never go to sleep, since a missed webhook is a missed reply.

## Option B: Fly.io

Similar flow, has a low-cost always-on tier. `fly launch` in the project folder,
follow the prompts, `fly secrets set KEY=value` for each env var, `fly deploy`.
Good if you want more control over region (pick one near your leads for lower
latency).

## Option C: A small VPS (DigitalOcean/Linode/AWS Lightsail)

More setup, more control, cheapest at scale. Rough steps:
```
git clone <your-repo>
cd whatsapp-outreach-agent
npm install
cp .env.example .env   # fill in real values
npm install -g pm2
pm2 start src/webhookServer.js --name whatsapp-agent
pm2 save && pm2 startup   # survives reboots
```
Put nginx or Caddy in front for HTTPS (Caddy gets you a free auto-renewing cert
with almost no config — a couple of lines in a Caddyfile pointing to
`localhost:3000`).

## Whichever you pick

- **Do not use Render's free tier** for this — it spins the server down after 15
  minutes of inactivity, so the first webhook after a quiet spell arrives at a
  dead server and WhatsApp only retries briefly. Their paid tier is fine.
- After deploying, go back to `docs/SETUP_META.md` step 7 and point the webhook at
  your real URL.
- Test the round trip before relying on it: message your own business number from
  a phone, watch the server logs (`railway logs`, `fly logs`, or `pm2 logs`), and
  confirm you get a reply and see rows appear in the `conversations` table.
- Note that this is also the first real end-to-end test of the database code —
  I couldn't reach your Neon instance from the sandbox I built this in (see
  `docs/SETUP_DATABASE.md`), so watch the logs closely on the first outreach
  batch and the first inbound reply.

## Running outreach batches

`npm run outreach` sends the initial template to every lead with
`status = 'pending'`, once. To
run it on a schedule (e.g. every weekday morning) without a separate cron
service, add this to the top of `src/webhookServer.js`:

```js
const cron = require('node-cron');
const { runOutreachBatch } = require('./outreachRunner');
// 10:00 AM IST daily = 04:30 UTC
cron.schedule('30 4 * * 1-5', () => runOutreachBatch().catch(console.error));
```

Or trigger it via your host's own scheduled-job feature if it has one (Railway
Cron Jobs, a GitHub Action, etc) hitting a small authenticated endpoint — up to
you; the in-process `node-cron` above is the simplest starting point.
