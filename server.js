const app = require('./app.js');
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  CORS Proxy + Ad Filter + Iframe Bypass  v2.1.0          ║
╠════════════════════════════════════════════════════════════╣
║  Local:    http://localhost:${PORT}${' '.repeat(36 - PORT.toString().length)}║
║  Health:   http://localhost:${PORT}/health${' '.repeat(32 - PORT.toString().length)}║
╚════════════════════════════════════════════════════════════╝
  `);
});
