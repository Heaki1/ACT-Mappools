const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// osu! API credentials
const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;

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

  const response = await axios.post('https://osu.ppy.sh/oauth/token', {
    client_id,
    client_secret,
    grant_type: 'client_credentials',
    scope: 'public'
  });

  access_token = response.data.access_token;
  token_expiry = now + (response.data.expires_in * 1000) - 10000;
  return access_token;
}

// API route to fetch beatmap info
app.get('/api/beatmap/:id', async (req, res) => {
  try {
    const token = await getAccessToken();
    const id = req.params.id;

    const response = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const bm = response.data;

    const data = {
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
    };

    res.json(data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch beatmap info from osu! API' });
  }
});

// API route to send beatmap info to Discord
app.post('/api/send-discord', async (req, res) => {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  const entry = req.body;

  if (!entry || !entry.title) {
    return res.status(400).json({ error: "Invalid beatmap payload" });
  }

  const embed = {
    title: `🎵 New Beatmap Added: ${entry.title}`,
    url: entry.url,
    color: 0x8e44ad,
    fields: [
      { name: "Slot", value: entry.slot, inline: true },
      { name: "Mod", value: entry.mod, inline: true },
      { name: "Stars", value: entry.stars, inline: true },
      { name: "CS", value: entry.cs, inline: true },
      { name: "AR", value: entry.ar, inline: true },
      { name: "OD", value: entry.od, inline: true },
      { name: "BPM", value: entry.bpm, inline: true },
      { name: "Skill Focus", value: entry.skill || "N/A", inline: true },
      { name: "Notes", value: entry.notes || "None", inline: false }
    ],
    thumbnail: { url: entry.cover_url },
    footer: { text: "ACT Beatmap Selector" },
    timestamp: new Date()
  };

  try {
    await axios.post(webhookUrl, { embeds: [embed] });
    res.json({ success: true });
  } catch (err) {
    console.error("Discord webhook error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to send to Discord" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
