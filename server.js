const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Import Database
const db = require('./database');

const app = express();
const port = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Set this in Render Environment Variables

// Trust proxy - CRITICAL for Render
app.set('trust proxy', 1);

// Security Headers
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

// CORS
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password']
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'development',
});

const discordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skip: (req) => process.env.NODE_ENV === 'development',
});

// ==========================================
// 👤 USER SYSTEM
// ==========================================

app.post('/api/users/register', apiLimiter, (req, res) => {
  const { display_name } = req.body;

  if (!display_name || display_name.length < 3 || display_name.length > 20) {
    return res.status(400).json({ error: 'Display name must be 3-20 characters' });
  }

  const newId = uuidv4();
  
  try {
    const stmt = db.prepare('INSERT INTO users (id, display_name) VALUES (?, ?)');
    stmt.run(newId, display_name);
    res.json({ id: newId, display_name, is_admin: 0 });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.get('/api/users/:id', apiLimiter, (req, res) => {
  try {
    const stmt = db.prepare('SELECT id, display_name, is_admin FROM users WHERE id = ?');
    const user = stmt.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// 🎵 BEATMAP MANAGEMENT (Public)
// ==========================================

app.post('/api/beatmaps/submit', apiLimiter, (req, res) => {
  // We accept 'submitted_by_name' to restore the user if DB was wiped (Self-Healing)
  const { title, url, stars, cs, ar, od, bpm, length, slot, mod, skill, notes, cover_url, preview_url, type, submitted_by, submitted_by_name } = req.body;

  if (!title || !url || !submitted_by) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // --- SELF HEALING FIX START ---
    // 1. Check if user exists in the DB (Render might have wiped it)
    const userCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(submitted_by);
    
    if (!userCheck) {
        console.log(`⚠️ User ${submitted_by} not found in DB. Auto-restoring...`);
        // 2. Re-create the user instantly so submission succeeds
        const restoreUser = db.prepare('INSERT INTO users (id, display_name) VALUES (?, ?)');
        restoreUser.run(submitted_by, submitted_by_name || 'Unknown User');
    }
    // --- SELF HEALING FIX END ---

    const stmt = db.prepare(`
      INSERT INTO beatmaps (title, url, stars, cs, ar, od, bpm, length, slot, mod, skill, notes, cover_url, preview_url, type, submitted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(title, url, stars, cs, ar, od, bpm, length, slot, mod, skill, notes, cover_url, preview_url, type, submitted_by);
    
    console.log(`✅ New map submitted: ${title} (ID: ${result.lastInsertRowid})`);
    res.json({ success: true, id: result.lastInsertRowid });

  } catch (error) {
    console.error('Submit Error:', error);
    res.status(500).json({ error: 'Failed to submit beatmap. ' + error.message });
  }
});

app.get('/api/beatmaps/list', apiLimiter, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM beatmaps ORDER BY created_at DESC');
    const maps = stmt.all();
    res.json(maps);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ==========================================
// 🔐 ADMIN DASHBOARD API (Restored!)
// ==========================================

// 1. Admin Login
app.post('/api/admin/login', apiLimiter, (req, res) => {
    const { password } = req.body;
    // Check against Environment Variable or default
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: 'admin-session-active' });
    } else {
        res.status(401).json({ error: 'Wrong password' });
    }
});

// 2. Delete Map (Protected)
app.delete('/api/beatmaps/:id', apiLimiter, (req, res) => {
    const password = req.headers['x-admin-password'];
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized: Wrong Password' });
    }

    try {
        // Delete related data first to respect Foreign Keys
        db.prepare('DELETE FROM votes WHERE beatmap_id = ?').run(req.params.id);
        db.prepare('DELETE FROM comments WHERE beatmap_id = ?').run(req.params.id);
        
        // Delete the map
        const info = db.prepare('DELETE FROM beatmaps WHERE id = ?').run(req.params.id);
        
        if (info.changes > 0) {
            console.log(`🗑️ Map ${req.params.id} deleted by Admin`);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Map not found' });
        }
    } catch (err) {
        console.error("Delete failed:", err);
        res.status(500).json({ error: 'Delete failed' });
    }
});

// ==========================================
// 🗳️ VOTING SYSTEM
// ==========================================

app.get('/api/beatmaps/:id/votes', apiLimiter, (req, res) => {
  const beatmapId = req.params.id;
  try {
    const upvotes = db.prepare("SELECT COUNT(*) as count FROM votes WHERE beatmap_id = ? AND vote_type = 'upvote'").get(beatmapId);
    const downvotes = db.prepare("SELECT COUNT(*) as count FROM votes WHERE beatmap_id = ? AND vote_type = 'downvote'").get(beatmapId);
    
    let userVote = null;
    if (req.query.user_id) {
        const vote = db.prepare("SELECT vote_type FROM votes WHERE beatmap_id = ? AND user_id = ?").get(beatmapId, req.query.user_id);
        if (vote) userVote = vote.vote_type;
    }

    res.json({ upvotes: upvotes.count, downvotes: downvotes.count, user_vote: userVote });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch votes' });
  }
});

app.post('/api/beatmaps/:id/vote', apiLimiter, (req, res) => {
  const beatmapId = req.params.id;
  const { user_id, vote_type } = req.body;

  if (!['upvote', 'downvote'].includes(vote_type)) return res.status(400).json({ error: 'Invalid vote' });
  if (!user_id) return res.status(401).json({ error: 'User ID required' });

  try {
    // Self-healing check for voters too
    const userCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!userCheck) {
         db.prepare('INSERT INTO users (id, display_name) VALUES (?, ?)').run(user_id, 'Voter');
    }

    const existingVote = db.prepare('SELECT vote_type FROM votes WHERE beatmap_id = ? AND user_id = ?').get(beatmapId, user_id);

    if (existingVote) {
      if (existingVote.vote_type === vote_type) {
        db.prepare('DELETE FROM votes WHERE beatmap_id = ? AND user_id = ?').run(beatmapId, user_id);
      } else {
        db.prepare('UPDATE votes SET vote_type = ? WHERE beatmap_id = ? AND user_id = ?').run(vote_type, beatmapId, user_id);
      }
    } else {
      db.prepare('INSERT INTO votes (beatmap_id, user_id, vote_type) VALUES (?, ?, ?)').run(beatmapId, user_id, vote_type);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to vote' });
  }
});

// ==========================================
// 💬 COMMENTS SYSTEM
// ==========================================

app.get('/api/beatmaps/:id/comments', apiLimiter, (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM comments WHERE beatmap_id = ? ORDER BY created_at DESC');
    res.json(stmt.all(req.params.id));
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/beatmaps/:id/comments', apiLimiter, (req, res) => {
  const { user_id, display_name, comment_text } = req.body;
  const beatmapId = req.params.id;

  if (!comment_text || !comment_text.trim()) return res.status(400).json({ error: 'Empty comment' });

  try {
    // Self-healing check for comments
    const userCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!userCheck) {
         db.prepare('INSERT INTO users (id, display_name) VALUES (?, ?)').run(user_id, display_name || 'Commenter');
    }

    const stmt = db.prepare('INSERT INTO comments (beatmap_id, user_id, display_name, comment_text) VALUES (?, ?, ?, ?)');
    stmt.run(beatmapId, user_id, display_name, comment_text);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// ==========================================
// 📡 OSU API PROXY
// ==========================================

const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;
let access_token = null;
let token_expiry = 0;

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function getAccessToken() {
  const now = Date.now();
  if (access_token && now < token_expiry) return access_token;
  if (!client_id || !client_secret) return null;

  try {
    console.log('🔄 Fetching new osu! API token...');
    const response = await axios.post('https://osu.ppy.sh/oauth/token', {
      client_id, client_secret, grant_type: 'client_credentials', scope: 'public'
    });
    access_token = response.data.access_token;
    token_expiry = now + (response.data.expires_in * 1000) - 10000;
    return access_token;
  } catch (err) {
    console.error("❌ Failed to get osu! token:", err.message);
    return null;
  }
}

app.get('/api/beatmap/:id', apiLimiter, async (req, res) => {
  try {
    const token = await getAccessToken();
    if (!token) return res.status(500).json({ error: 'API not configured' });

    const response = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Accept': 'application/json' }
    });

    const bm = response.data;
    res.json({
      title: `${bm.beatmapset.artist} - ${bm.beatmapset.title} [${bm.version}]`,
      stars: bm.difficulty_rating.toFixed(2),
      cs: bm.cs, ar: bm.ar, od: bm.accuracy, bpm: bm.bpm,
      length: formatSeconds(bm.total_length || 0),
      url: `https://osu.ppy.sh/beatmapsets/${bm.beatmapset.id}#osu/${bm.id}`,
      preview_url: bm.beatmapset.preview_url,
      cover_url: bm.beatmapset.covers.card
    });
  } catch (err) {
    console.error("Beatmap fetch error:", err.message);
    res.status(err.response?.status || 500).json({ error: 'Failed to fetch info' });
  }
});

// ==========================================
// 🔧 UTILS & PAGES
// ==========================================

// Discord Webhook
const discord_webhook = process.env.DISCORD_WEBHOOK;
app.post('/api/send-discord', discordLimiter, async (req, res) => {
  if (!discord_webhook) return res.status(503).json({ error: 'No webhook' });

  try {
    const entry = req.body;

    const embed = {
      title: `💰 New ${entry.type === "bounty" ? "Bounty" : "Suggestion"}: ${entry.title}`,
      url: entry.url,
      color: entry.type === "bounty" ? 0xf1c40f : 0x8e44ad,
      fields: [
        { name: "👤 Submitted by", value: entry.submitted_by_name || "Unknown", inline: true },
        { name: "🎯 Challenge", value: entry.skill || "N/A", inline: true },
        { name: "🧩 Mods", value: entry.mod || "NM", inline: true },
        { name: "⭐ Stars", value: entry.stars || "N/A", inline: true },
        { name: "🔗 Link", value: entry.url || "N/A", inline: false }
      ],
      thumbnail: { url: entry.cover_url || "" }
    };

    await axios.post(discord_webhook, { embeds: [embed] });
    res.json({ success: true });
  } catch (err) {
    console.error("Discord webhook failed:", err);
    res.status(500).json({ error: "Failed to send to Discord" });
  }
});

// Serve HTML Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/community', (req, res) => res.sendFile(path.join(__dirname, 'public', 'community.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html'))); // Tournament suggestions
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))); // Admin Management

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

// Start Server
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${port}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
