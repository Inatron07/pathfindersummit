# Follow the Money: WhatsApp front end

Text the bot from an admin number:

| Message | What happens |
|---|---|
| STATUS | Counts of new, assigned and completed alerts, one line per case |
| PROCESS | Starts FTM_RunAgent in Automation Anywhere (claims, investigates, files, completes). About 5 min, then the results arrive here |
| RESULT | Repeats the last run report |
| HELP | Command list |

Any other message, or a message from a non-admin number, goes to the normal lead agent.

All investigation work (claim, decide, file, complete) happens inside AA. This server only starts the
AA run and reads the bank records (read-only) to report status and results.

## Setup
1. In Co-Pilot > Manage > Processes > FTM_RunAgent: set Request creation to "by bot", keep team Pathfinder Summit Imaging Insurgency, save. Note the process id.
2. Control Room: generate an API key for the user that will start the run.
3. Fill the FTM section of `.env` (see `.env.example`) and set `FTM_ENABLED=true`.
4. `npm install` then `npm start`. Message STATUS from your phone.

WhatsApp only allows free-form replies within 24 h of your last message to the bot, so send any
message first if the new-alert ping (FTM_ALERT_POLL_MIN) has not reached you.

Code: `src/ftm/` (aaClient.js, bankClient.js, ftmCommands.js), hooked in `src/webhookServer.js`.
