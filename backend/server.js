process.on('uncaughtException', (err) => {
  if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT' || err.message?.includes('ECONNRESET'))) {
    console.warn('[Backend] Suppressed network exception:', err.message);
    return;
  }
  console.error('[Backend] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Backend] Suppressed unhandled rejection:', reason);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { setupSocket } = require('./discordManager');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// ── 7/24 Cloud & Render Keep-Alive / Health Endpoints ────────────────────────
app.get('/ping', (req, res) => {
  res.status(200).send('Dragon Service 24/7 Voice Engine: OK');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// ── Static Web App Serving for Cloud / Render / VDS ──────────────────────────
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    const indexPath = path.join(frontendDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send('Dragon Service Cloud Server Running');
    }
  });
}

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100 MB buffer for media & chunks
});

setupSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Dragon Service] 24/7 Cloud & Local Server listening on port ${PORT}`);
  
  // Render.com Free Tier 7/24 Uyanık Tutucu (Self-Keepalive Pinger)
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (externalUrl) {
    console.log(`[Keepalive] 24/7 Cloud URL detected: ${externalUrl}`);
    setInterval(() => {
      try {
        const pingUrl = externalUrl.endsWith('/') ? `${externalUrl}ping` : `${externalUrl}/ping`;
        http.get(pingUrl, (res) => {
          // Keepalive ping sent
        }).on('error', () => {});
      } catch(e) {}
    }, 4 * 60 * 1000); // 4 dakikada bir ping atarak uyumasını engeller
  }
});

