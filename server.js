const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

/* =====================
   Middleware
===================== */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =====================
   Rate limit (optional but recommended)
===================== */
const suggestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: "Too many requests, slow down." }
});

/* =====================
   Serve pages
===================== */
app.get("/admin", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "admin.html"))
);

app.get("/suggest", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "suggest.html"))
);

/* =====================
   osu! API Auth
===================== */
const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;

let access_token = null;
let token_expiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (access_token && now < token_expiry) return access_token;

  const r = await axios.post("https://osu.ppy.sh/oauth/token", {
    client_id,
    client_secret,
    grant_type: "client_credentials",
    scope: "public"
  });

  access_token = r.data.access_token;
  token_expiry = now + r.data.expires_in * 1000 - 10_000;
  return access_token;
}

function formatSeconds(sec = 0) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* =====================
   GET beatmap info
===================== */
app.get("/api/beatmap/:id", async (req, res) => {
  try {
    const token = await getAccessToken();
    const id = req.params.id;

    const r = await axios.get(
      `https://osu.ppy.sh/api/v2/beatmaps/${id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const bm = r.data;

    res.json({
      title: `${bm.beatmapset.artist} - ${bm.beatmapset.title} (${bm.beatmapset.creator})`,
      stars: bm.difficulty_rating.toFixed(1),
      cs: bm.cs,
      ar: bm.ar,
      od: bm.accuracy,
      bpm: bm.bpm,
      length: formatSeconds(bm.total_length),
      url: `https://osu.ppy.sh/beatmapsets/${bm.beatmapset.id}#osu/${bm.id}`,
      preview_url: bm.beatmapset.preview_url,
      cover_url: bm.beatmapset.covers.card
    });
  } catch (err) {
    console.error("Beatmap fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch beatmap" });
  }
});

/* =====================
   PUBLIC: Send suggestion to Discord
===================== */
app.post("/api/suggest", suggestLimiter, async (req, res) => {
  const b = req.body;

  if (!b?.url) {
    return res.status(400).json({ error: "Beatmap URL required" });
  }

  const embed = {
    title: "📥 Beatmap Suggestion",
    description: `[Open beatmap](${b.url})`,
    color: 0x3498db,
    fields: [
      { name: "Slot", value: b.slot || "Not specified", inline: true },
      { name: "Mod", value: b.mod || "N/A", inline: true },
      { name: "Suggested by", value: b.user || "Anonymous", inline: true },
      { name: "Notes", value: b.notes || "None", inline: false }
    ],
    thumbnail: b.cover_url ? { url: b.cover_url } : undefined,
    footer: { text: "Community suggestion" },
    timestamp: new Date()
  };

  try {
    await axios.post(process.env.DISCORD_WEBHOOK, {
      embeds: [embed]
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Discord error:", err.message);
    res.status(500).json({ error: "Failed to send to Discord" });
  }
});

/* =====================
   Start server
===================== */
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
