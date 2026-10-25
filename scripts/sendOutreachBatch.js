// Run manually with: npm run outreach
// Or schedule it (e.g. via your host's cron, or node-cron inside webhookServer.js)
// to run once a day during business hours.
const { runOutreachBatch } = require('../src/outreachRunner');

runOutreachBatch()
  .then((result) => {
    console.log('Outreach batch complete:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Outreach batch failed:', err);
    process.exit(1);
  });
