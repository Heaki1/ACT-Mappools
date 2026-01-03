const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Make sure to npm install uuid if you haven't
const db = require('./database');       // Import the database connection

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate Limiting (Optional: Adjust as per roadmap)
// const rateLimit = require('express-rate-limit');
// const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 100 });
// app.use(limiter);

// --- User API Endpoints (Phase 2) ---

// POST /api/users/register
// Registers a new user or returns existing one if ID provided (basic implementation)
app.post('/api/users/register', (req, res) => {
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

// GET /api/users/:id
// Fetch user details
app.get('/api/users/:id', (req, res) => {
    try {
        const stmt = db.prepare('SELECT id, display_name, is_admin FROM users WHERE id = ?');
        const user = stmt.get(req.params.id);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

// --- Existing OSU API Proxy ---

// (Keep your existing /api/beatmap-info routes here to preserve current functionality)
// Example:
app.get('/api/beatmap-info', async (req, res) => {
    const { url } = req.query;
    // ... existing logic ...
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
