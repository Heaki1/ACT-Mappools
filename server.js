const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://osu.ppy.sh"]
    }
  }
}));

// CORS - restrict to your domain only
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://act-mappools.onrender.com' 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json({ limit: '10kb' })); // Limit payload size
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 API requests per windowMs
  message: { error: 'Too many API requests, please try again later' }
});

const discordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 Discord submissions per windowMs
  message: { error: 'Too many submissions, please try again later' }
});

// Apply general rate limiter to all routes
app.use(generalLimiter);

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve admin pages (no auth as requested)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/bounties', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bounties.html'));
});

// osu! API credentials
const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;

let access_token = null;
let token_expiry = 0;

// Input validation helpers
function isValidBeatmapId(id) {
  return /^\d+$/.test(id) && parseInt(id) > 0 && parseInt(id) < 999999999;
}

function sanitizeString(str, maxLength = 1000) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, maxLength);
}

function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateEntry(entry) {
  const errors = [];

  // Required fields
  if (!entry.title || typeof entry.title !== 'string') {
    errors.push('Title is required and must be a string');
  }
  if (!entry.url || !isValidUrl(entry.url)) {
    errors.push('Valid URL is required');
  }

  // Validate type
  if (entry.type && !['suggestion', 'bounty'].includes(entry.type)) {
    errors.push('Type must be "suggestion" or "bounty"');
  }

  // Validate numeric fields if present
  const numericFields = ['stars', 'cs', 'ar', 'od', 'bpm'];
  numericFields.forEach(field => {
    if (entry[field] !== undefined && entry[field] !== null && entry[field] !== '') {
      const num = parseFloat(entry[field]);
      if (isNaN(num) || num < 0 || num > 999) {
        errors.push(`${field} must be a valid number between 0 and 999`);
      }
    }
  });

  return errors;
}

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
    return access_token;
  } catch (error) {
    console.error('Failed to get osu! access token');
    throw new Error('Authentication failed');
  }
}

// API route to fetch beatmap info
app.get('/api/beatmap/:id', apiLimiter, async (req, res) => {
  try {
    const id = req.params.id;

    // Validate beatmap ID
    if (!isValidBeatmapId(id)) {
      return res.status(400).json({ error: 'Invalid beatmap ID format' });
    }

    const token = await getAccessToken();

    const response = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000 // 10 second timeout
    });

    const bm = response.data;

    // Validate response data
    if (!bm || !bm.beatmapset) {
      return res.status(404).json({ error: 'Beatmap not found' });
    }

    const data = {
      title: `${sanitizeString(bm.beatmapset.artist, 100)} - ${sanitizeString(bm.beatmapset.title, 100)} [${sanitizeString(bm.version, 50)}]`,
      stars: parseFloat(bm.difficulty_rating).toFixed(2),
      cs: parseFloat(bm.cs).toFixed(1),
      ar: parseFloat(bm.ar).toFixed(1),
      od: parseFloat(bm.accuracy).toFixed(1),
      bpm: Math.round(bm.bpm),
      length: formatSeconds(bm.total_length || 0),
      url: `https://osu.ppy.sh/beatmapsets/${bm.beatmapset.id}#osu/${bm.id}`,
      preview_url: bm.beatmapset.preview_url || '',
      cover_url: bm.beatmapset.covers?.card || ''
    };

    res.json(data);
  } catch (err) {
    // Don't expose internal error details
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Beatmap not found' });
    }
    console.error('Beatmap API error:', err.message);
    res.status(500).json({ error: 'Failed to fetch beatmap information' });
  }
});

// API route to send submissions to Discord
app.post('/api/send-discord', discordLimiter, async (req, res) => {
  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK;

    // Verify webhook URL is configured
    if (!webhookUrl || !isValidUrl(webhookUrl)) {
      console.error('Discord webhook URL not properly configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const entry = req.body;

    // Validate entry
    const validationErrors = validateEntry(entry);
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validationErrors 
      });
    }

    // Sanitize all string inputs
    const sanitizedEntry = {
      title: sanitizeString(entry.title, 200),
      url: entry.url, // Already validated
      type: entry.type || 'suggestion',
      slot: sanitizeString(entry.slot, 50),
      mod: sanitizeString(entry.mod || entry.mods, 50),
      mods: sanitizeString(entry.mod || entry.mods, 50),
      stars: entry.stars ? parseFloat(entry.stars).toFixed(2) : 'N/A',
      cs: entry.cs ? parseFloat(entry.cs).toFixed(1) : 'N/A',
      ar: entry.ar ? parseFloat(entry.ar).toFixed(1) : 'N/A',
      od: entry.od ? parseFloat(entry.od).toFixed(1) : 'N/A',
      bpm: entry.bpm ? Math.round(parseFloat(entry.bpm)) : 'N/A',
      skill: sanitizeString(entry.skill || entry.challenge, 500),
      challenge: sanitizeString(entry.skill || entry.challenge, 500),
      difficulty: sanitizeString(entry.difficulty || entry.notes, 500),
      notes: sanitizeString(entry.difficulty || entry.notes, 500),
      cover_url: entry.cover_url && isValidUrl(entry.cover_url) ? entry.cover_url : ''
    };

    // Determine type for embed
    const type = sanitizedEntry.type === "bounty" ? "Bounty" : "Suggestion";

    const embed = {
      title: `🎵 New ${type} Added: ${sanitizedEntry.title}`,
      url: sanitizedEntry.url,
      color: type === "Bounty" ? 0xf1c40f : 0x8e44ad,
      fields: [
        { name: "Type", value: type, inline: true },
        { name: "Slot", value: sanitizedEntry.slot || "N/A", inline: true },
        { name: "Mod", value: sanitizedEntry.mod || "N/A", inline: true },
        { name: "Stars", value: sanitizedEntry.stars, inline: true },
        { name: "CS", value: sanitizedEntry.cs, inline: true },
        { name: "AR", value: sanitizedEntry.ar, inline: true },
        { name: "OD", value: sanitizedEntry.od, inline: true },
        { name: "BPM", value: sanitizedEntry.bpm, inline: true },
        { name: "Skill / Challenge", value: sanitizedEntry.skill || "N/A", inline: false },
        { name: "Difficulty / Notes", value: sanitizedEntry.difficulty || "None", inline: false }
      ],
      thumbnail: sanitizedEntry.cover_url ? { url: sanitizedEntry.cover_url } : undefined,
      footer: { text: "ACT Beatmap Selector" },
      timestamp: new Date().toISOString()
    };

    await axios.post(webhookUrl, 
      { embeds: [embed] },
      { 
        timeout: 10000, // 10 second timeout
        headers: { 'Content-Type': 'application/json' }
      }
    );

    res.json({ success: true, message: 'Submission sent successfully' });
  } catch (err) {
    console.error("Discord webhook error:", err.message);
    
    // Don't expose internal error details
    if (err.response?.status === 429) {
      return res.status(429).json({ error: 'Rate limited by Discord, please try again later' });
    }
    
    res.status(500).json({ error: "Failed to send submission" });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
