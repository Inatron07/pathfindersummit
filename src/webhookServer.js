const path = require('path');
const express = require('express');
const config = require('./config');
const whatsapp = require('./whatsappClient');
const db = require('./dbClient');
const agent = require('./claudeAgent');
const bulkSend = require('./bulkSend');
const ftm = require('./ftm/ftmCommands');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// ── Test console (public/index.html) ────────────────────────────────────
// A small local UI for trying out real sending/receiving without touching
// Neon's SQL editor or curl-ing Meta's API by hand. See docs/TRY_IT_LOCALLY.md.
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Webhook verification (Meta calls this once when you save the URL) ──────
app.get('/webhook', (req, res) => {
  const challenge = whatsapp.verifyWebhookChallenge(req.query);
  if (challenge) {
    console.log('[webhook] verification succeeded');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] verification failed — check WHATSAPP_VERIFY_TOKEN matches the dashboard');
  return res.sendStatus(403);
});

// ── Inbound messages ─────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Always ack fast — WhatsApp retries aggressively if you don't 200 quickly.
  res.sendStatus(200);

  const incoming = whatsapp.parseIncomingMessage(req.body);
  if (!incoming) return; // status update (delivered/read), not a user message

  try {
    await handleIncomingMessage(incoming);
  } catch (err) {
    console.error('[webhook] error handling incoming message', err);
  }
});

async function handleIncomingMessage(incoming) {
  const { from, name, text } = incoming;
  console.log(`[inbound] ${from} (${name || 'unknown'}): ${text}`);

  // Follow the Money commands from admin numbers (STATUS, PROCESS, RESULT, HELP)
  if (await ftm.handle(from, text)) return;

  let lead = await db.findLeadByPhone(from);
  if (!lead) {
    // Someone messaged us who isn't in the leads table yet — create a
    // minimal record instead of silently dropping the conversation.
    lead = await db.createLead({
      name: name || 'Unknown',
      phone: from,
      inquiry_source: 'Inbound (not pre-loaded)',
      status: 'replied',
    });
  }

  await db.appendConversationLog(from, 'in', text);

  const history = await db.getConversationHistory(from, 20);
  // history already includes the message we just logged — drop it before
  // handing "history" + "current message" separately to the agent.
  const { replyText, toolUpdate } = await agent.generateReply(lead, history.slice(0, -1), text);

  if (replyText) {
    await whatsapp.sendTextMessage(from, replyText);
    await db.appendConversationLog(from, 'out', replyText);
  }

  const fields = { last_inbound: new Date().toISOString() };
  if (toolUpdate?.status) fields.status = toolUpdate.status;
  if (toolUpdate?.notes) fields.notes = toolUpdate.notes;
  if (toolUpdate?.status) fields.conversation_stage = toolUpdate.status;
  await db.updateLead(lead.id, fields);

  if (toolUpdate?.status === 'needs_human' || toolUpdate?.status === 'booked_viewing') {
    console.log(`[escalation] ${from} (${lead.name}) needs a human — status: ${toolUpdate.status}`);
    // TODO: hook up a Slack/email alert here so a human actually sees this.
  }
}

// ── Test console API ─────────────────────────────────────────────────────
app.get('/api/meta', (req, res) => {
  res.json({
    businessName: config.business.name,
    agentName: config.business.agentName,
    templateName: config.whatsapp.outreachTemplateName,
    templateLang: config.whatsapp.outreachTemplateLang,
  });
});

app.get('/api/leads', async (req, res) => {
  try {
    res.json(await db.getAllLeads());
  } catch (err) {
    console.error('[api] failed to load leads', err);
    res.status(500).json({ error: 'Could not load leads — is DATABASE_URL correct and reachable?' });
  }
});

app.post('/api/leads', async (req, res) => {
  try {
    const { name, phone, area } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const lead = await db.createLead({
      name: name || null,
      phone,
      area: area || null,
      inquiry_source: 'Added via test console',
      status: 'pending',
    });
    res.json(lead);
  } catch (err) {
    console.error('[api] failed to create lead', err);
    res.status(500).json({ error: 'Could not save that lead' });
  }
});

app.get('/api/messages/:phone', async (req, res) => {
  try {
    res.json(await db.getConversationHistory(req.params.phone, 100));
  } catch (err) {
    console.error('[api] failed to load messages', err);
    res.status(500).json({ error: 'Could not load conversation history' });
  }
});

// Freeform text — only works within the 24h window after the lead has
// messaged in (WhatsApp policy, not a bug in this app).
app.post('/api/send', async (req, res) => {
  try {
    const { phone, text } = req.body || {};
    if (!phone || !text) return res.status(400).json({ error: 'phone and text are required' });
    await whatsapp.sendTextMessage(phone, text);
    await db.appendConversationLog(phone, 'out', text);
    const lead = await db.findLeadByPhone(phone);
    if (lead) await db.updateLead(lead.id, { last_contacted: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error('[api] failed to send message', detail);
    res.status(500).json({ error: detail });
  }
});

// Approved template — required for the first message, or to re-open a
// conversation once the 24h window has closed.
app.post('/api/send-template', async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const lead = await db.findLeadByPhone(phone);
    const firstName = (lead?.name || 'there').split(' ')[0];

    await whatsapp.sendTemplateMessage(
      phone,
      config.whatsapp.outreachTemplateName,
      config.whatsapp.outreachTemplateLang,
      [firstName]
    );
    await db.appendConversationLog(
      phone,
      'out',
      `[template: ${config.whatsapp.outreachTemplateName}] outreach message sent to ${firstName}`
    );
    if (lead) {
      await db.updateLead(lead.id, { status: 'sent', last_contacted: new Date().toISOString() });
    }
    res.json({ ok: true });
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error('[api] failed to send template', detail);
    res.status(500).json({ error: detail });
  }
});

// Bulk outreach — send to many leads at once from the test console's
// "Bulk outreach" pane. mode "template" (default) uses the approved opening
// template personalized per-lead; mode "text" sends a custom freeform
// message, which only actually reaches leads currently inside the 24h
// window (others come back with ok:false in the results — expected).
app.post('/api/send-bulk', async (req, res) => {
  try {
    const { phones, mode, text } = req.body || {};
    if (!Array.isArray(phones) || !phones.length) {
      return res.status(400).json({ error: 'phones must be a non-empty array' });
    }
    if (phones.length > bulkSend.MAX_RECIPIENTS_PER_REQUEST) {
      return res.status(400).json({
        error: `Max ${bulkSend.MAX_RECIPIENTS_PER_REQUEST} recipients per send from the console — for larger batches use "npm run outreach".`,
      });
    }

    if (mode === 'text') {
      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'text is required for a custom message' });
      }
      const results = await bulkSend.sendTextToPhones(phones, text.trim());
      return res.json({ results });
    }

    const results = await bulkSend.sendTemplateToPhones(phones);
    res.json({ results });
  } catch (err) {
    console.error('[api] bulk send failed', err);
    res.status(500).json({ error: 'Bulk send failed' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Optional: ping admins on WhatsApp when new AML alerts appear.
if (config.ftm.enabled && config.ftm.alertPollMin > 0) {
  cron.schedule(`*/${config.ftm.alertPollMin} * * * *`, () => ftm.checkForNewAlerts());
}
// Keep a free Render instance awake so the alert check keeps running
// (free services sleep after 15 min without inbound traffic).
if (config.ftm.enabled && config.ftm.keepAliveUrl) {
  const axios = require('axios');
  cron.schedule('*/10 * * * *', () =>
    axios.get(`${config.ftm.keepAliveUrl}/health`, { timeout: 20000 }).catch(() => {})
  );
}

app.listen(config.port, () => {
  console.log(`WhatsApp outreach agent listening on port ${config.port}`);
});
