// Automation Anywhere Control Room client: logs in and starts the
// FTM_RunAgent process as a Co-Pilot request created by bot.
const axios = require('axios');
const config = require('../config');

let cached = { token: null, at: 0 };

async function token() {
  // Control Room tokens last about 20 min; refresh after 15.
  if (cached.token && Date.now() - cached.at < 15 * 60 * 1000) return cached.token;
  const r = await axios.post(
    `${config.ftm.aaUrl}/v2/authentication`,
    { username: config.ftm.aaUsername, apiKey: config.ftm.aaApiKey },
    { timeout: 30000 }
  );
  cached = { token: r.data.token, at: Date.now() };
  return cached.token;
}

// Starts FTM_RunAgent exactly the way the Control Room "Run now" button does:
// POST /v4/automations/deploy with the process file id, the pInstruction input
// and the Co-Pilot team that owns the request.
async function startRun(instruction) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '.').slice(2, 19);
  const body = {
    botId: String(config.ftm.processFileId),
    automationName: `FTM_RunAgent.WhatsApp.${stamp}`,
    description: 'Started from WhatsApp',
    botLabel: null,
    botInput: { pInstruction: { type: 'STRING', string: instruction } },
    processRequest: { teamId: String(config.ftm.teamId) },
    executionType: 'RUN_NOW',
  };
  const r = await axios.post(`${config.ftm.aaUrl}/v4/automations/deploy`, body, {
    headers: { 'X-Authorization': await token(), 'Content-Type': 'application/json' },
    timeout: 60000,
    validateStatus: () => true,
  });
  if (r.status >= 300) {
    const detail = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    throw new Error(`AA deploy failed (${r.status}): ${detail.slice(0, 400)}`);
  }
  return { reference: r.data?.deploymentId || r.data?.automationId || '' };
}

module.exports = { startRun };
