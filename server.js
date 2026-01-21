const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const db = require("./database");
const app = express();
const port = process.env.PORT || 3000;

app.set("trust proxy", 1);

// CSP
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // tighten later after removing all inline scripts
        connectSrc: ["'self'", "https://osu.ppy.sh", "https://b.ppy.sh", "https://*.onrender.com"],
        mediaSrc: ["'self'", "https:", "http:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-user-id"],
  })
);

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "development",
});

const discordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skip: () => process.env.NODE_ENV === "development",
});

function getUserId(req) {
  return req.headers["x-user-id"];
}

// USER SYSTEM
app.post("/api/users/register", apiLimiter, async (req, res) => {
  const { display_name } = req.body;

  if (!display_name || display_name.length < 3 || display_name.length > 20) {
    return res.status(400).json({ error: "Display name must be 3-20 characters" });
  }

  const newId = uuidv4();

  try {
    await db.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [newId, display_name]);
    console.log(`👤 Registered user: ${display_name} (${newId}) from ${req.ip}`);
    res.json({ id: newId, display_name, is_admin: false });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ error: "Failed to register user" });
  }
});

app.get("/api/users/:id", apiLimiter, async (req, res) => {
  try {
    const result = await db.query("SELECT id, display_name, is_admin FROM users WHERE id = $1", [
      req.params.id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Database error" });
  }
});

// BEATMAPS

app.post("/api/beatmaps/submit", apiLimiter, async (req, res) => {
  const {
    title,
    url,
    stars,
    cs,
    ar,
    od,
    bpm,
    length,
    slot,
    mod,
    skill,
    notes,
    cover_url,
    preview_url,
    type,
    submitted_by,
    submitted_by_name,
  } = req.body;

  if (!title || !url || !submitted_by) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // self-heal user
    const userCheck = await db.query("SELECT id FROM users WHERE id = $1", [submitted_by]);
    if (userCheck.rowCount === 0) {
      await db.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [
        submitted_by,
        submitted_by_name || "Unknown User",
      ]);
    }

    const insert = await db.query(
      `
      INSERT INTO beatmaps
      (title, url, stars, cs, ar, od, bpm, length, slot, mod, skill, notes, cover_url, preview_url, type, submitted_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id
    `,
      [
        title,
        url,
        stars,
        cs,
        ar,
        od,
        bpm,
        length,
        slot,
        mod,
        skill,
        notes,
        cover_url,
        preview_url,
        type,
        submitted_by,
      ]
    );

    res.json({ success: true, id: insert.rows[0].id });
  } catch (error) {
    console.error("Submit Error:", error);
    res.status(500).json({ error: "Failed to submit beatmap. " + error.message });
  }
});

app.get("/api/beatmaps/list", apiLimiter, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT b.*, u.display_name AS submitted_by_name
      FROM beatmaps b
      LEFT JOIN users u ON u.id = b.submitted_by
      ORDER BY b.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Owner-only update
app.put("/api/beatmaps/:id", apiLimiter, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "User ID required (x-user-id missing)" });

  const id = Number(req.params.id);

  try {
    const existing = await db.query("SELECT submitted_by, type FROM beatmaps WHERE id = $1", [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Map not found" });

    if (String(existing.rows[0].submitted_by) !== String(userId)) {
      return res.status(403).json({ error: "Not allowed (not owner)" });
    }

    const body = req.body || {};
    const safeType = body.type || existing.rows[0].type || "bounty";

    await db.query(
      `
      UPDATE beatmaps
      SET title=$1, url=$2, stars=$3, cs=$4, ar=$5, od=$6, bpm=$7, length=$8,
          slot=$9, mod=$10, skill=$11, notes=$12, cover_url=$13, preview_url=$14, type=$15
      WHERE id=$16
    `,
      [
        body.title ?? null,
        body.url ?? null,
        body.stars ?? null,
        body.cs ?? null,
        body.ar ?? null,
        body.od ?? null,
        body.bpm ?? null,
        body.length ?? null,
        body.slot ?? null,
        body.mod ?? null,
        body.skill ?? null,
        body.notes ?? null,
        body.cover_url ?? null,
        body.preview_url ?? null,
        safeType,
        id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// Owner-only delete
app.delete("/api/beatmaps/:id", apiLimiter, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "User ID required (x-user-id missing)" });

  const id = Number(req.params.id);

  try {
    const existing = await db.query("SELECT submitted_by FROM beatmaps WHERE id = $1", [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Map not found" });

    if (String(existing.rows[0].submitted_by) !== String(userId)) {
      return res.status(403).json({ error: "Not allowed (not owner)" });
    }

    await db.query("DELETE FROM beatmaps WHERE id = $1", [id]); // cascades votes/comments if schema uses ON DELETE CASCADE
    res.json({ success: true });
  } catch (err) {
    console.error("Delete failed:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// VOTES
app.get("/api/beatmaps/:id/votes", apiLimiter, async (req, res) => {
  const beatmapId = Number(req.params.id);

  try {
    const up = await db.query(
      "SELECT COUNT(*)::int AS count FROM votes WHERE beatmap_id=$1 AND vote_type='upvote'",
      [beatmapId]
    );
    const down = await db.query(
      "SELECT COUNT(*)::int AS count FROM votes WHERE beatmap_id=$1 AND vote_type='downvote'",
      [beatmapId]
    );

    let userVote = null;
    if (req.query.user_id) {
      const v = await db.query("SELECT vote_type FROM votes WHERE beatmap_id=$1 AND user_id=$2", [
        beatmapId,
        req.query.user_id,
      ]);
      if (v.rowCount > 0) userVote = v.rows[0].vote_type;
    }

    res.json({ upvotes: up.rows[0].count, downvotes: down.rows[0].count, user_vote: userVote });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch votes" });
  }
});

app.post("/api/beatmaps/:id/vote", apiLimiter, async (req, res) => {
  const beatmapId = Number(req.params.id);
  const { user_id, vote_type } = req.body;

  if (!["upvote", "downvote"].includes(vote_type)) return res.status(400).json({ error: "Invalid vote" });
  if (!user_id) return res.status(401).json({ error: "User ID required" });

  try {
    // self-heal user
    const userCheck = await db.query("SELECT id FROM users WHERE id=$1", [user_id]);
    if (userCheck.rowCount === 0) {
      await db.query("INSERT INTO users (id, display_name) VALUES ($1,$2)", [user_id, "Voter"]);
    }

    const existing = await db.query("SELECT vote_type FROM votes WHERE beatmap_id=$1 AND user_id=$2", [
      beatmapId,
      user_id,
    ]);

    if (existing.rowCount > 0) {
      if (existing.rows[0].vote_type === vote_type) {
        await db.query("DELETE FROM votes WHERE beatmap_id=$1 AND user_id=$2", [beatmapId, user_id]);
      } else {
        await db.query("UPDATE votes SET vote_type=$1 WHERE beatmap_id=$2 AND user_id=$3", [
          vote_type,
          beatmapId,
          user_id,
        ]);
      }
    } else {
      await db.query("INSERT INTO votes (beatmap_id, user_id, vote_type) VALUES ($1,$2,$3)", [
        beatmapId,
        user_id,
        vote_type,
      ]);
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to vote" });
  }
});


app.get("/api/beatmaps/:id/comments", apiLimiter, async (req, res) => {
  const beatmapId = Number(req.params.id);
  try {
    const result = await db.query("SELECT * FROM comments WHERE beatmap_id=$1 ORDER BY created_at DESC", [
      beatmapId,
    ]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/beatmaps/:id/comments", apiLimiter, async (req, res) => {
  const beatmapId = Number(req.params.id);
  const { user_id, display_name, comment_text } = req.body;

  if (!comment_text || !comment_text.trim()) return res.status(400).json({ error: "Empty comment" });

  try {
    const userCheck = await db.query("SELECT id FROM users WHERE id=$1", [user_id]);
    if (userCheck.rowCount === 0) {
      await db.query("INSERT INTO users (id, display_name) VALUES ($1,$2)", [
        user_id,
        display_name || "Commenter",
      ]);
    }

    await db.query(
      "INSERT INTO comments (beatmap_id, user_id, display_name, comment_text) VALUES ($1,$2,$3,$4)",
      [beatmapId, user_id, display_name || "Unknown", comment_text]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

// OSU API PROXY
const client_id = process.env.OSU_CLIENT_ID;
const client_secret = process.env.OSU_CLIENT_SECRET;
let access_token = null;
let token_expiry = 0;

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

async function getAccessToken() {
  const now = Date.now();
  if (access_token && now < token_expiry) return access_token;
  if (!client_id || !client_secret) return null;

  const response = await axios.post("https://osu.ppy.sh/oauth/token", {
    client_id,
    client_secret,
    grant_type: "client_credentials",
    scope: "public",
  });

  access_token = response.data.access_token;
  token_expiry = now + response.data.expires_in * 1000 - 10000;
  return access_token;
}

app.get("/api/beatmap/:id", apiLimiter, async (req, res) => {
  try {
    const token = await getAccessToken();
    if (!token) return res.status(500).json({ error: "API not configured" });

    const response = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${req.params.id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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
      cover_url: bm.beatmapset.covers.card,
    });
  } catch (err) {
    console.error("Beatmap fetch error:", err.message);
    res.status(err.response?.status || 500).json({ error: "Failed to fetch info" });
  }
});

// DISCORD WEBHOOK
const discord_webhook = process.env.DISCORD_WEBHOOK;

app.post("/api/send-discord", discordLimiter, async (req, res) => {
  if (!discord_webhook) return res.status(503).json({ error: "No webhook" });

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
        { name: "🔗 Link", value: entry.url || "N/A", inline: false },
      ],
      thumbnail: { url: entry.cover_url || "" },
    };

    await axios.post(discord_webhook, { embeds: [embed] });
    res.json({ success: true });
  } catch (err) {
    console.error("Discord webhook failed:", err);
    res.status(500).json({ error: "Failed to send to Discord" });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/community", (req, res) => res.sendFile(path.join(__dirname, "public", "community.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/api/health", (req, res) => res.json({ status: "ok", env: process.env.NODE_ENV || "production" }));

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
});
