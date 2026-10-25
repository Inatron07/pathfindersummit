const config = require('./config');
const whatsapp = require('./whatsappClient');
const db = require('./dbClient');

const DELAY_MS_BETWEEN_SENDS = 1500; // stay well under WhatsApp rate limits
const DAILY_SEND_CAP = 250; // safety cap; raise once your messaging limit tier is higher

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends the approved outreach template to every lead with status 'pending'.
 * Updates their row to 'sent' and logs the message.
 *
 * The template must already be APPROVED in WhatsApp Manager — see
 * docs/SETUP_META.md. This function assumes a template with exactly one
 * body variable, {{1}} = the lead's first name. Adjust bodyParams below to
 * match your actual approved template.
 */
async function runOutreachBatch() {
  const pending = await db.getPendingLeads();

  console.log(`[outreach] ${pending.length} pending leads found`);
  let sent = 0;

  for (const lead of pending) {
    if (sent >= DAILY_SEND_CAP) {
      console.log(`[outreach] hit daily cap of ${DAILY_SEND_CAP}, stopping`);
      break;
    }
    if (!lead.phone) {
      console.warn(`[outreach] lead id ${lead.id} has no phone number, skipping`);
      continue;
    }

    const phone = String(lead.phone).replace(/\D/g, '');
    const firstName = (lead.name || '').split(' ')[0] || 'there';

    try {
      await whatsapp.sendTemplateMessage(
        phone,
        config.whatsapp.outreachTemplateName,
        config.whatsapp.outreachTemplateLang,
        [firstName]
      );
      await db.updateLead(lead.id, {
        status: 'sent',
        last_contacted: new Date().toISOString(),
      });
      await db.appendConversationLog(
        phone,
        'out',
        `[template: ${config.whatsapp.outreachTemplateName}] sent to ${firstName}`
      );
      console.log(`[outreach] sent to ${phone} (${firstName})`);
      sent += 1;
    } catch (err) {
      console.error(`[outreach] FAILED for ${phone}:`, err.response?.data || err.message);
      await db.updateLead(lead.id, { status: 'send_failed' });
    }

    await sleep(DELAY_MS_BETWEEN_SENDS);
  }

  console.log(`[outreach] done. sent ${sent}/${pending.length}`);
  return { attempted: pending.length, sent };
}

module.exports = { runOutreachBatch };
