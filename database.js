const Database = require('better-sqlite3');
const path = require('path');

// Connect to SQLite database (creates file if not exists)
const db = new Database(path.join(__dirname, 'mappool.db'), { verbose: console.log });

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize Database Schema
const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS beatmaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    stars TEXT,
    cs TEXT,
    ar TEXT,
    od TEXT,
    bpm TEXT,
    length TEXT,
    slot TEXT,
    mod TEXT,
    skill TEXT,
    notes TEXT,
    cover_url TEXT,
    preview_url TEXT,
    type TEXT,           -- 'suggestion' or 'bounty'
    status TEXT DEFAULT 'pending',
    submitted_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (submitted_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    beatmap_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    vote_type TEXT NOT NULL, -- 'upvote' or 'downvote'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(beatmap_id, user_id),
    FOREIGN KEY (beatmap_id) REFERENCES beatmaps(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    beatmap_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    comment_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (beatmap_id) REFERENCES beatmaps(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`;

db.exec(schema);

module.exports = db;
