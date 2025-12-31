const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

/* -------------------- SECURITY -------------------- */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'"
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com"
        ],

        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com"
        ],

        imgSrc: [
          "'self'",
          "data:",
          "https:",
          "https://assets.ppy.sh"
        ],

        mediaSrc: [
          "'self'",
          "https://assets.ppy.sh"
        ],

        connectSrc: [
          "'self'",
          "https://osu.ppy.sh",
          "https://assets.ppy.sh"
        ]
      }
    }
  })
);

/* -------------------- CORS -------------------- */
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? 'https://act-mappools.onrender.com'
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST'],
}));

/* -------------------- BODY / STATIC -------------------- */
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* -------------------- RATE LIMITS -------------------- */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60
});

const discordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10
});

app.use(generalLimiter);

/* -------------------- ROUTES -------------------- */
app.get('/', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.get('/admin', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);

app.get('/bounties', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'bounties.html'))
);

/* -------------------- OSU AUTH -------------------- */
const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;

let access_token = null;
let token_expiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (access_token && now < token_expiry) return access_token;

  const res = await axios.post('https://osu.ppy.sh/oauth/token', {
    client_id,
    client_secret,
    grant_type: 'client_credentials',
    scope: 'public'
  });

  access_token = res.data.access_token;
  token_expiry = now + res.data.expires_in * 1000 - 10000;
  return access_token;
}

const formatSeconds = s =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/* -------------------- API -------------------- */
app.get('/api/beatmap/:id', apiLimiter, async (req, res) => {
  try {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid ID' });

    const token = await getAccessToken();

    const r = await axios.get(
      `https://osu.ppy.sh/api/v2/beatmaps/${id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const bm = r.data;

    res.json({
      title: `${bm.beatmapset.artist} - ${bm.beatmapset.title} [${bm.version}]`,
      stars: bm.difficulty_rating.toFixed(2),
      cs: bm.cs.toFixed(1),
      ar: bm.ar.toFixed(1),
      od: bm.accuracy.toFixed(1),
      bpm: Math.round(bm.bpm),
      length: formatSeconds(bm.total_length),
      url: `https://osu.ppy.sh/beatmapsets/${bm.beatmapset.id}#osu/${bm.id}`,
      preview_url: bm.beatmapset.preview_url,
      cover_url: bm.beatmapset.covers.card
    });
  } catch {
    res.status(500).json({ error: 'Beatmap fetch failed' });
  }
});

/* -------------------- DISCORD -------------------- */
app.post('/api/send-discord', discordLimiter, async (req, res) => {
  try {
    await axios.post(process.env.DISCORD_WEBHOOK, req.body);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Discord failed' });
  }
});

/* -------------------- ERRORS -------------------- */
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

app.listen(port, () =>
  console.log(`✅ Server running on port ${port}`)
);
