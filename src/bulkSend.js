const config = require('./config');
const whatsapp = require('./whatsappClient');
const db = require('./dbClient');

// Same conservative pacing as scripts/sendOutreachBatch.js — stay well under
// WhatsApp's rate limits when firing off a batch from the test console.
const DELAY_MS_BETWEEN_SENDS = 1500;
const MAX_RECIPIENTS_PER_REQUEST = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePhone(phone) {
  return String(phone).replace(/\D/g, '');
}

/**
 * Sends the approved outreach template (personalized with each lead's first
 * name) to a list of phone numbers. Works regardless of the 24h window —
 * this is the only reliable way to message someone cold or re-open a stale
 * conversation.
 */
async function sendTemplateToPhones(phones) {
  const results = [];
  for (const raw of phones.slice(0, MAX_RECIPIENTS_PER_REQUEST)) {
    const phone = normalizePhone(raw);
    const lead = await db.findLeadByPhone(phone);
    const firstName = (lead?.name || '').split(' ')[0] || 'there';

    try {
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
      results.push({ phone, name: lead?.name || null, ok: true });
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.message;
      if (lead) await db.updateLead(lead.id, { status: 'send_failed' });
      results.push({ phone, name: lead?.name || null, ok: false, error: detail });
    }

    await sleep(DELAY_MS_BETWEEN_SENDS);
  }
  return results;
}

/**
 * Sends a custom freeform message to a list of phone numbers. Only actually
 * delivers to leads within the 24h customer-service window (WhatsApp policy)
 * — others will come back as failures in the results array, which is
 * expected, not a bug.
 */
async function sendTextToPhones(phones, text) {
  const results = [];
  for (const raw of phones.slice(0, MAX_RECIPIENTS_PER_REQUEST)) {
    const phone = normalizePhone(raw);
    try {
      await whatsapp.sendTextMessage(phone, text);
      await db.appendConversationLog(phone, 'out', text);
      const lead = await db.findLeadByPhone(phone);
      if (lead) await db.updateLead(lead.id, { last_contacted: new Date().toISOString() });
      results.push({ phone, name: lead?.name || null, ok: true });
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.message;
      results.push({ phone, ok: false, error: detail });
    }

    await sleep(DELAY_MS_BETWEEN_SENDS);
  }
  return results;
}

module.exports = {
  sendTemplateToPhones,
  sendTextToPhones,
  MAX_RECIPIENTS_PER_REQUEST,
  DELAY_MS_BETWEEN_SENDS,
};
