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

// Starts FTM_RunAgent with the given instruction (its pInstruction input).
async function startRun(instruction) {
  const body = {
    processId: config.ftm.copilotProcessId,
    inputs: { pInstruction: instruction },
  };
  if (config.ftm.copilotTeamId) body.teamId = config.ftm.copilotTeamId;
  const r = await axios.post(`${config.ftm.aaUrl}/aari/v2/requests/create?mode=bot`, body, {
    headers: { 'X-Authorization': await token(), 'Content-Type': 'application/json' },
    timeout: 60000,
    validateStatus: () => true,
  });
  if (r.status >= 300) {
    const detail = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    throw new Error(`AA request create failed (${r.status}): ${detail.slice(0, 400)}`);
  }
  return r.data; // includes the request id / reference
}

module.exports = { startRun };
