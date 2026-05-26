require('dotenv').config();
const app = require('./app');
const { cleanupExpired } = require('./utils/token');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n  Reelogue → ${process.env.SITE_URL || `http://localhost:${PORT}`}`);
  console.log(`  Listening on port ${PORT}\n`);
});

// Periodically clean up expired auth tokens.
setInterval(() => cleanupExpired(), 5 * 60 * 1000);

// Optionally run the bot in the same process: RUN_BOT=1 npm start
if (process.env.RUN_BOT === '1') {
  require('../bot');
}
