const Database = require('better-sqlite3');
const path = require('path');

// Create or connect to database
const db = new Database(path.join(__dirname, 'mappool.db'), { 
  verbose: console.log 
});

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
function initDatabase() {
  console.log('🔧 Initializing database...');

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Beatmaps table
  db.exec(`
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
      download_url TEXT,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      submitted_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submitted_by) REFERENCES users(id)
    )
  `);

  // Votes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      beatmap_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      vote_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(beatmap_id, user_id),
      FOREIGN KEY (beatmap_id) REFERENCES beatmaps(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Comments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      beatmap_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (beatmap_id) REFERENCES beatmaps(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  console.log('✅ Database initialized successfully');
}

// User queries
const userQueries = {
  // Create or get user
  createUser: db.prepare(`
    INSERT INTO users (id, display_name, is_admin)
    VALUES (?, ?, ?)
  `),

  getUserById: db.prepare(`
    SELECT * FROM users WHERE id = ?
  `),

  updateDisplayName: db.prepare(`
    UPDATE users SET display_name = ? WHERE id = ?
  `),

  makeAdmin: db.prepare(`
    UPDATE users SET is_admin = 1 WHERE id = ?
  `)
};

// Beatmap queries
const beatmapQueries = {
  // Create beatmap
  createBeatmap: db.prepare(`
    INSERT INTO beatmaps (
      title, url, stars, cs, ar, od, bpm, length,
      slot, mod, skill, notes, cover_url, preview_url,
      download_url, type, submitted_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  // Get beatmaps by status
  getBeatmapsByStatus: db.prepare(`
    SELECT b.*, u.display_name as submitter_name,
           (SELECT COUNT(*) FROM votes WHERE beatmap_id = b.id AND vote_type = 'upvote') as upvotes,
           (SELECT COUNT(*) FROM votes WHERE beatmap_id = b.id AND vote_type = 'downvote') as downvotes
    FROM beatmaps b
    LEFT JOIN users u ON b.submitted_by = u.id
    WHERE b.status = ?
    ORDER BY b.created_at DESC
  `),

  // Get single beatmap with vote counts
  getBeatmapById: db.prepare(`
    SELECT b.*, u.display_name as submitter_name,
           (SELECT COUNT(*) FROM votes WHERE beatmap_id = b.id AND vote_type = 'upvote') as upvotes,
           (SELECT COUNT(*) FROM votes WHERE beatmap_id = b.id AND vote_type = 'downvote') as downvotes
    FROM beatmaps b
    LEFT JOIN users u ON b.submitted_by = u.id
    WHERE b.id = ?
  `),

  // Update beatmap status
  updateBeatmapStatus: db.prepare(`
    UPDATE beatmaps SET status = ? WHERE id = ?
  `),

  // Delete beatmap
  deleteBeatmap: db.prepare(`
    DELETE FROM beatmaps WHERE id = ?
  `)
};

// Vote queries
const voteQueries = {
  // Add or update vote
  upsertVote: db.prepare(`
    INSERT INTO votes (beatmap_id, user_id, vote_type)
    VALUES (?, ?, ?)
    ON CONFLICT(beatmap_id, user_id)
    DO UPDATE SET vote_type = excluded.vote_type
  `),

  // Remove vote
  removeVote: db.prepare(`
    DELETE FROM votes WHERE beatmap_id = ? AND user_id = ?
  `),

  // Get user's vote on beatmap
  getUserVote: db.prepare(`
    SELECT vote_type FROM votes WHERE beatmap_id = ? AND user_id = ?
  `),

  // Get vote counts for beatmap
  getVoteCounts: db.prepare(`
    SELECT 
      SUM(CASE WHEN vote_type = 'upvote' THEN 1 ELSE 0 END) as upvotes,
      SUM(CASE WHEN vote_type = 'downvote' THEN 1 ELSE 0 END) as downvotes
    FROM votes
    WHERE beatmap_id = ?
  `)
};

// Comment queries
const commentQueries = {
  // Add comment
  addComment: db.prepare(`
    INSERT INTO comments (beatmap_id, user_id, display_name, comment_text)
    VALUES (?, ?, ?, ?)
  `),

  // Get comments for beatmap
  getCommentsByBeatmap: db.prepare(`
    SELECT * FROM comments
    WHERE beatmap_id = ?
    ORDER BY created_at DESC
  `),

  // Delete comment
  deleteComment: db.prepare(`
    DELETE FROM comments WHERE id = ?
  `)
};

// Export everything
module.exports = {
  db,
  initDatabase,
  userQueries,
  beatmapQueries,
  voteQueries,
  commentQueries
};