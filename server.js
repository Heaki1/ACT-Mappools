const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// osu! API credentials
const { OSU_CLIENT_ID, OSU_CLIENT_SECRET } = process.env;

let access_token = null;
let token_expiry = 0;

// Refresh token if expired
async function getAccessToken() {
  const now = Date.now();
  if (access_token && now < token_expiry) return access_token;

  try {
    const res = await axios.post('https://osu.ppy.sh/oauth/token', {
      client_id: OSU_CLIENT_ID,
      client_secret: OSU_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'public'
    });

    access_token = res.data.access_token;
    token_expiry = now + (res.data.expires_in * 1000) - 10000; // 10s buffer
    return access_token;
  } catch (err) {
    console.error("Token fetch error:", err.response?.data || err.message);
    throw new Error("Failed to get osu! access token");
  }
}

// Format seconds -> mm:ss
function formatSeconds(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Get beatmap info
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
      length: formatSeconds(bm.total_length),
      url: `https://osu.ppy.sh/beatmapsets/${bm.beatmapset.id}#osu/${bm.id}`,
      preview_url: bm.beatmapset.preview_url || `https://b.ppy.sh/preview/${bm.beatmapset.id}.mp3`,
      cover_url: bm.beatmapset.covers['cover'] || `https://assets.ppy.sh/beatmaps/${bm.beatmapset.id}/covers/cover.jpg`
    };

    res.json(data);
  } catch (err) {
    console.error("Beatmap fetch error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch beatmap info from osu! API" });
  }
});

// Optional: Discord webhook sender
app.post('/api/send-discord', async (req, res) => {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  const entry = req.body;
  if (!entry || !entry.title) return res.status(400).json({ error: "Invalid payload" });

  const embed = {
    title: `🎵 New Beatmap: ${entry.title}`,
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
      { name: "Skill", value: entry.skill || "N/A", inline: true },
      { name: "Notes", value: entry.notes || "None", inline: false }
    ],
    thumbnail: { url: entry.cover_url },
    timestamp: new Date()
  };

  try {
    await axios.post(webhookUrl, { embeds: [embed] });
    res.json({ success: true });
  } catch (err) {
    console.error("Discord error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to send to Discord" });
  }
});

app.listen(port, () => console.log(`✅ Server running at http://localhost:${port}`));
