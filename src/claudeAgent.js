const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const { buildSystemPrompt } = require('./systemPrompt');
const db = require('./dbClient');

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const UPDATE_LEAD_TOOL = {
  name: 'update_lead',
  description:
    "Update this lead's CRM record. Call this once per turn to reflect the current state of the conversation, before writing your reply.",
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['in_conversation', 'needs_human', 'not_interested', 'booked_viewing'],
      },
      notes: {
        type: 'string',
        description: 'Brief update: what you learned this turn (budget, area, timeline, etc).',
      },
    },
    required: ['status', 'notes'],
  },
};

const SEARCH_PROPERTIES_TOOL = {
  name: 'search_properties',
  description:
    'Search current available listings. Use this whenever the lead asks about specific properties, pricing, or what\'s available in an area — never guess or invent listing details. Returns up to 5 matches.',
  input_schema: {
    type: 'object',
    properties: {
      area: { type: 'string', description: 'Locality/area to filter by, e.g. "Whitefield"' },
      property_type: { type: 'string', description: 'e.g. "2BHK", "3BHK", "Villa", "Plot"' },
      min_price: { type: 'number', description: 'Minimum price in rupees' },
      max_price: { type: 'number', description: 'Maximum price in rupees' },
      min_bedrooms: { type: 'number' },
    },
  },
};

const TOOLS = [UPDATE_LEAD_TOOL, SEARCH_PROPERTIES_TOOL];
const MAX_TOOL_ROUNDS = 4;

/**
 * Given a lead record + prior conversation history + the new inbound message,
 * asks Claude for the next reply, letting it call update_lead and/or
 * search_properties along the way. Returns { replyText, toolUpdate } where
 * toolUpdate is the last { status, notes } the model set, or null.
 */
async function generateReply(lead, history, incomingText) {
  const messages = [
    ...history.map((h) => ({
      role: h.direction === 'in' ? 'user' : 'assistant',
      content: h.message,
    })),
    { role: 'user', content: incomingText },
  ];

  let toolUpdate = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 600,
      system: buildSystemPrompt(lead),
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const replyText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!toolUses.length) {
      return { replyText, toolUpdate };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const call of toolUses) {
      if (call.name === 'update_lead') {
        toolUpdate = call.input;
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: 'ok' });
      } else if (call.name === 'search_properties') {
        const matches = await db.searchProperties(call.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: matches.length
            ? JSON.stringify(matches)
            : 'No matching available properties found.',
        });
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: 'Unknown tool.',
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });

    // If the model already wrote its reply text in the SAME turn as the tool
    // calls, we still loop once more so it can incorporate tool results —
    // but if it stops calling tools next round we'll return that final text.
    if (replyText && round === MAX_TOOL_ROUNDS - 1) {
      return { replyText, toolUpdate };
    }
  }

  // Ran out of rounds without a clean stop — ask once more for just the reply.
  const followup = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 600,
    system: buildSystemPrompt(lead),
    messages,
  });
  const replyText = followup.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return { replyText, toolUpdate };
}

module.exports = { generateReply };
