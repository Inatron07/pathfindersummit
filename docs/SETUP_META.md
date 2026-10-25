# Completing your WhatsApp Cloud API setup

You mentioned you already tried creating a Meta app for your personal number. A few
things trip everyone up at this stage — read this before you go further, especially
if the number you registered is a personal/testing number rather than the real
business line.

## 1. Use a Business Meta account, not a personal one

Go to [business.facebook.com](https://business.facebook.com) and make sure you have
a **Meta Business Account** for the real estate company (not your personal Facebook
login). Create one if you don't have it yet — it's free. All the WhatsApp assets
(the app, the WhatsApp Business Account, the phone number) should live under this
business account, not a personal profile.

## 2. Create the app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) →
   **Create App** → type **Business** → give it a name (e.g. "Acme Realty Outreach").
2. Once created, on the app dashboard click **Add Product** → find **WhatsApp** →
   **Set up**.
3. This auto-creates a **WhatsApp Business Account (WABA)** under your business
   account, plus gives you a **free test phone number** you can use immediately
   for development (messages only reach numbers you manually add as testers).

## 3. Add your real business number

This is the step that actually matters for outreach, and it's important to
understand up front: **registering a number with the Cloud API removes it from the
regular WhatsApp Business app on your phone.** You can't use both at once on the
same number (there's a newer "coexistence" beta that allows both, but it's not
available everywhere yet — don't rely on it). If your team is actively using the
WhatsApp Business app on that number day-to-day, decide now whether you want:
- a **second number** dedicated to the automated agent, or
- to **migrate** your current number over (you'll lose the phone-app access to it).

To add the number: in the app, go to **WhatsApp → API Setup** (or **WhatsApp Manager**
directly) → **Add phone number** → enter the business number → verify via SMS or
voice call code.

## 4. Get a permanent access token

The token shown by default on the API Setup page **expires in 24 hours** — fine for
testing, useless for a deployed agent. Get a permanent one:

1. Go to **Meta Business Suite → Business Settings → Users → System Users**.
2. Create a system user (e.g. "outreach-agent"), role **Admin**.
3. Click **Add Assets** → select your WhatsApp Business Account → give it **Full
   control**.
4. Click **Generate New Token** → select your app → check the
   `whatsapp_business_messaging` and `whatsapp_business_management` permissions →
   generate. **Copy this token now — Meta only shows it once.** This is your
   `WHATSAPP_TOKEN`.

## 5. Note your IDs

Still on the **API Setup** page, copy:
- **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
- **WhatsApp Business Account ID** (you don't need this for the app itself, but
  keep it handy for template management)

## 6. Create and submit a message template

Any WhatsApp-initiated conversation with someone who hasn't messaged you in the
last 24 hours **must** start with a pre-approved template — freeform text will be
rejected by the API. Since your leads are warm (they inquired via your site/ads/
calls) but haven't necessarily messaged you *on WhatsApp*, you still need this for
the first message.

1. Go to **WhatsApp Manager → Message Templates → Create Template**.
2. **Category**: in practice, pick whichever Meta's own in-editor checker tells you
   to. We initially tried **Utility** here (cheaper, easier approval), but Meta's
   category-mismatch checker flagged our actual wording as Marketing content —
   turns out "Utility" is reserved specifically for order/account-status style
   messages, and any proactive "let's talk about properties" outreach reads as
   Marketing to their classifier regardless of how warm the lead is. Don't fight
   it by requesting a review; just follow what the checker recommends.
3. Template used here — name `kinesys_property_followup`, category **Marketing**,
   language English, one variable (the lead's first name), matching what
   `src/outreachRunner.js` sends:

   ```
   Hi {{1}}, this is Zara from KineSys. I'm reaching out about properties that
   might interest you. Do you have a few minutes to chat here on WhatsApp?
   ```

4. Submit and wait for approval (usually minutes, sometimes up to 24h). Whatever
   name you use must match `OUTREACH_TEMPLATE_NAME` in `.env` exactly.

## 7. Point the webhook at your deployed server

Once you've deployed the app (see `DEPLOYMENT.md`), come back to **App → WhatsApp →
Configuration → Webhook**:
- **Callback URL**: `https://<your-deployed-url>/webhook`
- **Verify token**: whatever you set as `WHATSAPP_VERIFY_TOKEN` in `.env` — it just
  has to match on both sides.
- Subscribe to the **messages** field.

## 8. Know the limits

- New WhatsApp Business Accounts start on a **messaging tier** capped at 250
  business-initiated conversations/24h to unique numbers, which increases
  automatically as you maintain good quality/response rates.
- As of July 2025 Meta moved to **per-message pricing** with no meaningful free
  monthly tier for business-initiated messages — every outreach message you send
  is billed (replies within an open chat stay free). Rate depends on category
  and destination country; check the live rate card in WhatsApp Manager → Business
  Settings → Billing, since Meta updates these periodically.
- Business verification (submitting company documents) is not always required to
  send messages, but Meta may prompt for it to raise your tier — worth doing early
  if you plan real volume.
