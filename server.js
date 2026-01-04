const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid'); // Added UUID for user IDs
require('dotenv').config();

// Import Database Instance
const db = require('./database');

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy - CRITICAL for Render
app.set('trust proxy', 1);

// Enhanced helmet config for Render
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://osu.ppy.sh", "https://b.ppy.sh", "https://*.onrender.com"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Better CORS for production
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight
app.options('*', cors());

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'development',
  message: { error: 'Too many requests, try again later.' }
});

const discordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skip: (req) => process.env.NODE_ENV === 'development',
  message: { error: 'Too many submissions, please slow down.' }
});

// --- User Management API Endpoints (New) ---
// --- Beatmap Management API Endpoints ---

// Submit a new beatmap

app.post('/api/beatmaps/submit', apiLimiter, (req, res) => {
  const { title, url, stars, cs, ar, od, bpm, length, slot, mod, skill, notes, cover_url, preview_url, type, submitted_by } = req.body;

  if (!title || !url || !submitted_by) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO beatmaps (title, url, stars, cs, ar, od, bpm, length, slot, mod, skill, notes, cover_url, preview_url, type, submitted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(title, url, stars, cs, ar, od, bpm, length, slot, mod, skill, notes, cover_url, preview_url, type, submitted_by);
    
    console.log(`✅ New map submitted: ${title} (ID: ${result.lastInsertRowid})`);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Submit Error:', error);
    res.status(500).json({ error: 'Failed to submit beatmap' });
  }
});

// Get all approved/pending beatmaps
app.get('/api/beatmaps/list', apiLimiter, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM beatmaps ORDER BY created_at DESC');
    const maps = stmt.all();
    res.json(maps);
  } catch (error) {
    console.error('Fetch Error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/community', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'community.html'));
});

// Register a new user
app.post('/api/users/register', apiLimiter, (req, res) => {
  const { display_name } = req.body;

  // Basic validation
  if (!display_name || display_name.length < 3 || display_name.length > 20) {
    return res.status(400).json({ error: 'Display name must be 3-20 characters' });
  }

  // Check for alphanumeric/spaces only (simple regex)
  const nameRegex = /^[a-zA-Z0-9 ]+$/;
  if (!nameRegex.test(display_name)) {
      return res.status(400).json({ error: 'Display name contains invalid characters' });
  }

  const newId = uuidv4();
  
  try {
    const stmt = db.prepare('INSERT INTO users (id, display_name) VALUES (?, ?)');
    stmt.run(newId, display_name);
    
    console.log(`👤 New user registered: ${display_name} (${newId})`);
    res.json({ id: newId, display_name, is_admin: 0 });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Get user info
app.get('/api/users/:id', apiLimiter, (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, display_name, is_admin FROM users WHERE id = ?');
    const user = stmt.get(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('User Fetch Error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// --- Existing Logic Below ---
// --- Comment API Endpoints ---

// Get comments for a beatmap
app.get('/api/beatmaps/:id/comments', apiLimiter, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM comments WHERE beatmap_id = ? ORDER BY created_at DESC');
    const comments = stmt.all(req.params.id);
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Add a comment
app.post('/api/beatmaps/:id/comments', apiLimiter, (req, res) => {
  const { user_id, display_name, comment_text } = req.body;
  const beatmapId = req.params.id;

  if (!comment_text || comment_text.trim().length === 0) {
    return res.status(400).json({ error: 'Comment cannot be empty' });
  }

  try {
    const stmt = db.prepare('INSERT INTO comments (beatmap_id, user_id, display_name, comment_text) VALUES (?, ?, ?, ?)');
    stmt.run(beatmapId, user_id, display_name, comment_text);
    res.json({ success: true });
  } catch (error) {
    console.error('Comment error:', error);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// Serve pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/bounties', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'beatmaps.html'));
});

// Validate environment variables
const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;
const discord_webhook = process.env.DISCORD_WEBHOOK;

if (!client_id || !client_secret) {
  console.error('❌ ERROR: OSU_CLIENT_ID and OSU_CLIENT_SECRET must be set');
  if (process.env.NODE_ENV !== 'production') {
    // console.error('🛑 Exiting because credentials are missing');
    // process.exit(1); 
    // Commented out exit to allow DB testing without OSU creds if needed
  } else {
    console.error('⚠️  Server will start but API calls will fail!');
  }
}

let access_token = null;
let token_expiry = 0;

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function getAccessToken() {
  const now = Date.now();
  if (access_token && now < token_expiry) {
    return access_token;
  }

  if (!client_id || !client_secret) {
    throw new Error('OSU API credentials not configured');
  }

  try {
    console.log('🔄 Fetching new osu! API token...');
    const response = await axios.post('https://osu.ppy.sh/oauth/token', {
      client_id,
      client_secret,
      grant_type: 'client_credentials',
      scope: 'public'
    }, {
      timeout: 15000
    });
    
    access_token = response.data.access_token;
    token_expiry = now + (response.data.expires_in * 1000) - 10000;
    console.log('✅ Successfully got osu! API token');
    return access_token;
  } catch (err) {
    console.error("❌ Failed to get osu! token:", err.response?.data || err.message);
    throw new Error("OAuth token fetch failed");
  }
}

function sanitizeString(str, maxLength = 200) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLength).trim();
}

// API route with extensive logging
app.get('/api/beatmap/:id', apiLimiter, async (req, res) => {
  console.log(`📥 Beatmap request received: ${req.params.id}`);
  
  try {
    const token = await getAccessToken();
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid beatmap ID' });
    }

    console.log(`🔍 Fetching beatmap ${id} from osu! API...`);
    const response = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${id}`, {
      headers: { 
        Authorization: `Bearer ${token}`,
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    const bm = response.data;
    console.log(`✅ Successfully fetched: ${bm.beatmapset.artist} - ${bm.beatmapset.title}`);

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
    console.error("❌ Beatmap fetch error:", err.message);
    
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Beatmap not found' });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch beatmap info',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Admin verification
app.post('/api/admin/verify', apiLimiter, (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
  
  if (password === adminPassword) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Discord webhook
app.post('/api/send-discord', discordLimiter, async (req, res) => {
  if (!discord_webhook) {
    return res.status(503).json({ error: 'Discord webhook not configured' });
  }

  const entry = req.body;

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    discord: !!discord_webhook,
    osu_api: !!access_token,
    env: process.env.NODE_ENV || 'development',
    has_credentials: !!(client_id && client_secret)
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${port}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 OSU API: ${client_id ? 'Configured ✅' : 'Missing ❌'}`);
  console.log(`🎮 Discord: ${discord_webhook ? 'Configured ✅' : 'Missing ⚠️'}`);
  console.log(`🌐 Ready to accept connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, closing server gracefully...');
  server.close(() => {
    db.close(); // Close database connection
    console.log('✅ Server and Database closed');
    process.exit(0);
  });
});
