# Trying it out: real sending + receiving, from your own machine

This walks through using the built-in test console (`public/index.html`) to
send a real WhatsApp message and watch a real reply come back through Zara —
end to end, using your actual Meta and Neon credentials.

Important: **this has to run on your own computer**, not in a Claude sandbox.
Neither this app's Postgres connection nor its WhatsApp API calls can reach
the outside world from inside Claude's environment — only your machine (or a
real deployment, see `DEPLOYMENT.md`) can actually talk to Neon and Meta.

## 1. Install and configure

```bash
npm install
```

Make sure `.env` in the project root has every value filled in (you should
already have this — it's the same file used by the outreach script). At a
minimum it needs `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_VERIFY_TOKEN`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, and
`OUTREACH_TEMPLATE_NAME` matching a template that's status **Active** in
WhatsApp Manager.

## 2. Start the server

```bash
npm start
```

Then open **http://localhost:3000** in your browser. You'll see the KineSys
test console: a list of leads on the left (pulled live from your Neon
database), a chat panel in the middle, and a text box at the bottom.

At this point you can already **send**:

- Click a lead (or add one with the **+** button — phone number as digits
  only, with country code, e.g. `919604139376`).
- If you've never messaged them before, or it's been more than 24 hours since
  they last messaged *you*, click **Send template** — this fires your
  approved WhatsApp template (the same one `npm run outreach` uses) and is
  the only way to start or re-open a conversation.
- Once they're within the 24-hour window (they've messaged in, or you just
  sent a template and they replied), the plain text box works for freeform
  replies too.

This part doesn't need anything public-facing — it's a direct call from your
machine to Meta's Graph API.

## 3. Receiving replies (needs a public URL)

WhatsApp delivers replies by calling *your* server's `/webhook` endpoint —
which means Meta needs a public HTTPS URL for it, even for testing. The
fastest way to get one temporarily is [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

This prints a URL like `https://abcd1234.ngrok-free.app`. Then, in
**developers.facebook.com → your app → WhatsApp → Configuration → Webhook**:

- **Callback URL**: `https://abcd1234.ngrok-free.app/webhook`
- **Verify token**: the value of `WHATSAPP_VERIFY_TOKEN` in your `.env`
- Click **Verify and save**, then subscribe to the **messages** field if it
  isn't already checked.

Leave both `npm start` and `ngrok http 3000` running. Now when a lead texts
your WhatsApp number, it lands in the console within a few seconds — Zara
replies automatically (using the same persona and property-search tool the
real deployment will use), and you'll see both sides of the conversation
update live.

## 4. Sending to several leads at once

Click the checklist icon next to search to enter selection mode — checkboxes
appear on each lead, and the middle pane switches to **Bulk outreach**. Narrow
the list first with the area/interest dropdowns or the search box, then either
click leads individually or **Select all filtered**. From there:

- **Approved template** personalizes the opening template with each lead's
  first name — this is the only reliable choice for cold leads or anyone
  outside the 24h window (same message `npm run outreach` sends).
- **Custom message** sends your own wording, but WhatsApp will only actually
  deliver it to leads who messaged in within the last 24 hours; the console
  warns you up front how many selected leads would fail, and shows a
  per-recipient success/failure list after sending.

Sends are capped at 100 recipients per click and paced ~1.5s apart to stay
under WhatsApp's rate limits — for your full pending list, `npm run outreach`
from the CLI is still the right tool.

A few things worth knowing while testing this way:

- ngrok's free URL changes every time you restart it, so you'll need to
  update the Callback URL in Meta's dashboard each session.
- Every message — template or freeform, sent or received — is a real,
  billed WhatsApp message on your real number. Test with numbers you
  control.
- This is genuinely useful as your permanent local testing setup too, even
  after you deploy for real (`DEPLOYMENT.md`) — just point ngrok/webhook at
  whichever server you want to exercise at the time.
