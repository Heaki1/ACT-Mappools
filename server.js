const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://osu.ppy.sh", "https://b.ppy.sh"]
    }
  }
}));

// CORS - replace '*' with your actual domain in production
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json({ limit: '10kb' })); // Limit body size
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later.' }
});

const discordLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Max 10 Discord submissions per minute
  message: { error: 'Too many submissions, please slow down.' }
});

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/bounties', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bounties.html')));

// osu! API credentials validation
const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;
const discord_webhook = process.env.DISCORD_WEBHOOK;

if (!client_id || !client_secret) {
  console.error('❌ ERROR: OSU_CLIENT_ID and OSU_CLIENT_SECRET must be set in .env file');
  process.exit(1);
}

if (!discord_webhook) {
  console.warn('⚠️  WARNING: DISCORD_WEBHOOK not set - Discord notifications disabled');
}

let access_token = null;
let token_expiry = 0;

// Format seconds into mm:ss
function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Get or refresh osu! access token
async function getAccessToken() {
  const now = Date.now();
  if (access_token && now < token_expiry) return access_token;

  try {
    const response = await axios.post('https://osu.ppy.sh/oauth/token', {
      client_id,
      client_secret,
      grant_type: 'client_credentials',
      scope: 'public'
    });
    access_token = response.data.access_token;
    token_expiry = now + (response.data.expires_in * 1000) - 10000;
    console.log('✅ Successfully refreshed osu! API token');
    return access_token;
  } catch (err) {
    console.error("❌ Failed to get osu! token:", err.response?.data || err.message);
    throw new Error("OAuth token fetch failed");
  }
}

// Input validation helper
function sanitizeString(str, maxLength = 200) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLength).trim();
}

// API route to fetch beatmap info
app.get('/api/beatmap/:id', apiLimiter, async (req, res) => {
  try {
    const token = await getAccessToken();
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid beatmap ID' });
    }

    const response = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000 // 10 second timeout
    });

    const bm = response.data;

    res.json({
      title: `${bm.beatmapset.artist} - ${bm.beatmapset.title} [${bm.version}]`,
      stars: bm.difficulty_rating.toFixed(2),
      cs: bm.cs,
      ar: bm.ar,
      od: bm.accuracy,
      bpm: bm.bpm,
      length: formatSeconds(bm.total_length || 0),
      url: `https://osu.ppy.sh/beatmapsets/${bm.beatmapset.id}#osu/${bm.id}`,
      preview_url: bm.beatmapset.preview_url,
      cover_url: bm.beatmapset.covers.card
    });
  } catch (err) {
    console.error("❌ Beatmap fetch error:", err.response?.data || err.message);
    
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Beatmap not found' });
    }
    
    res.status(500).json({ error: 'Failed to fetch beatmap info' });
  }
});

// Admin authentication endpoint (NEW!)
app.post('/api/admin/verify', apiLimiter, (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
  
  if (password === adminPassword) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// API route to send submissions to Discord
app.post('/api/send-discord', discordLimiter, async (req, res) => {
  if (!discord_webhook) {
    return res.status(503).json({ error: 'Discord webhook not configured' });
  }

  const entry = req.body;

  // Enhanced validation
  if (!entry || typeof entry !== 'object') {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const title = sanitizeString(entry.title, 200);
  const url = sanitizeString(entry.url, 300);
  
  if (!title || !url) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const type = entry.type === "bounty" ? "Bounty" : "Suggestion";
  
  const embed = {
    title: `🎵 New ${type} Added: ${title}`,
    url: url,
    color: type === "Bounty" ? 0xf1c40f : 0x8e44ad,
    fields: [
      { name: "Type", value: type, inline: true },
      { name: "Slot", value: sanitizeString(entry.slot || "N/A", 50), inline: true },
      { name: "Mod", value: sanitizeString(entry.mod || entry.mods || "N/A", 50), inline: true },
      { name: "Stars", value: sanitizeString(entry.stars || "N/A", 20), inline: true },
      { name: "CS", value: sanitizeString(entry.cs || "N/A", 20), inline: true },
      { name: "AR", value: sanitizeString(entry.ar || "N/A", 20), inline: true },
      { name: "OD", value: sanitizeString(entry.od || "N/A", 20), inline: true },
      { name: "BPM", value: sanitizeString(entry.bpm || "N/A", 20), inline: true },
      { 
        name: "Skill / Challenge", 
        value: sanitizeString(entry.skill || entry.challenge || "N/A", 200), 
        inline: false 
      },
      { 
        name: "Difficulty / Notes", 
        value: sanitizeString(entry.difficulty || entry.notes || "None", 200), 
        inline: false 
      }
    ],
    thumbnail: { url: entry.cover_url || "" },
    footer: { text: "ACT Beatmap Selector" },
    timestamp: new Date()
  };

  try {
    await axios.post(discord_webhook, { 
      embeds: [embed] 
    }, {
      timeout: 10000
    });
    
    console.log(`✅ ${type} sent to Discord: ${title}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Discord webhook error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to send to Discord" });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    discord: !!discord_webhook,
    osu_api: !!access_token
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});
