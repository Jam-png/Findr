// Vercel detects this root Express entry point and deploys the exported app.
// Local development still starts backend/server.js through `npm start`.
module.exports = require('./backend/server');
