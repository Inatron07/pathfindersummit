const axios = require('axios');
const config = require('./config');

const BASE_URL = `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${config.whatsapp.phoneNumberId}/messages`;

function client() {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Send a pre-approved template message. Required for the FIRST message to
 * any number that hasn't messaged you in the last 24h (this is a WhatsApp
 * policy, not a choice — freeform text will simply fail to send).
 *
 * @param {string} to - E.164 phone number, no "+", e.g. "919876543210"
 * @param {string} templateName - must exactly match an APPROVED template name
 * @param {string} languageCode - e.g. "en"
 * @param {Array<{type:string, text:string}>} bodyParams - values for {{1}}, {{2}}, ... in the template body
 */
async function sendTemplateMessage(to, templateName, languageCode, bodyParams = []) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyParams.length
        ? [
            {
              type: 'body',
              parameters: bodyParams.map((text) => ({ type: 'text', text })),
            },
          ]
        : [],
    },
  };
  const res = await client().post('', payload);
  return res.data;
}

/**
 * Send a freeform text message. Only works within the 24h customer-service
 * window after the lead has messaged you (i.e. as a reply in an active chat).
 */
async function sendTextMessage(to, body) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body, preview_url: false },
  };
  const res = await client().post('', payload);
  return res.data;
}

/**
 * Handles the GET /webhook verification handshake Meta performs once when
 * you save the webhook URL in the App dashboard.
 */
function verifyWebhookChallenge(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    return challenge;
  }
  return null;
}

/**
 * Extracts the useful bits out of a raw WhatsApp webhook POST body.
 * Returns null if this payload isn't an inbound user message (e.g. it's a
 * delivery/read status update, which WhatsApp also posts to the same URL).
 */
function parseIncomingMessage(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message) return null; // status update, not a user message

    const contact = value?.contacts?.[0];
    const text =
      message.type === 'text'
        ? message.text?.body
        : message.type === 'button'
        ? message.button?.text
        : message.type === 'interactive'
        ? message.interactive?.button_reply?.title || message.interactive?.list_reply?.title
        : `[unsupported message type: ${message.type}]`;

    return {
      from: message.from, // phone number, no "+"
      name: contact?.profile?.name || null,
      text,
      type: message.type,
      timestamp: message.timestamp,
      messageId: message.id,
    };
  } catch (err) {
    console.error('[whatsappClient] failed to parse webhook payload', err);
    return null;
  }
}

module.exports = {
  sendTemplateMessage,
  sendTextMessage,
  verifyWebhookChallenge,
  parseIncomingMessage,
};
