require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val) {
    // eslint-disable-next-line no-console
    console.warn(`[config] WARNING: env var ${name} is not set yet.`);
  }
  return val;
}

module.exports = {
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  },
  whatsapp: {
    token: required('WHATSAPP_TOKEN'),
    phoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID'),
    verifyToken: required('WHATSAPP_VERIFY_TOKEN'),
    outreachTemplateName: process.env.OUTREACH_TEMPLATE_NAME || 'property_followup',
    outreachTemplateLang: process.env.OUTREACH_TEMPLATE_LANG || 'en',
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0',
  },
  db: {
    url: required('DATABASE_URL'),
  },
  business: {
    name: process.env.BUSINESS_NAME || 'Our Real Estate Team',
    agentName: process.env.AGENT_NAME || 'Assistant',
    context: process.env.BUSINESS_CONTEXT || '',
  },
  ftm: {
    // Follow the Money AML bot (WhatsApp front end for the AA agent)
    enabled: process.env.FTM_ENABLED === 'true',
    adminPhones: (process.env.FTM_ADMIN_PHONES || '').split(',').map((s) => s.trim()).filter(Boolean),
    aaUrl: (process.env.AA_URL || 'https://aa-community.cloud.automationanywhere.digital').replace(/\/$/, ''),
    aaUsername: process.env.AA_USERNAME,
    aaApiKey: process.env.AA_API_KEY,
    copilotProcessId: process.env.AA_COPILOT_PROCESS_ID,
    copilotTeamId: process.env.AA_COPILOT_TEAM_ID || null,
    bankBase: process.env.BANK_API_BASE || 'https://fuxjyedytrihhdolobrz.supabase.co/functions/v1',
    // Shared competition key (same for every team), kept in code on purpose.
    // Paste it between the quotes below. BANK_API_KEY in .env still overrides it.
    bankApiKey: process.env.BANK_API_KEY || 'PASTE_BANK_KEY_HERE',
    scanRange: (process.env.FTM_SCAN_RANGE || '2100-2400').split('-').map((n) => parseInt(n, 10)),
    runTimeoutMin: parseInt(process.env.FTM_RUN_TIMEOUT_MIN || '15', 10),
    alertPollMin: parseInt(process.env.FTM_ALERT_POLL_MIN || '0', 10), // 0 = off
  },
  port: parseInt(process.env.PORT || '3000', 10),
};
