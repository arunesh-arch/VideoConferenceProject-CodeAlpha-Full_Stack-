
import Database from 'better-sqlite3';

const db = new Database('B2C-Fun.sqlite');

// Enable SQLite foreign-key checks.
db.pragma('foreign_keys = ON');

// Create the users table if it does not already exist.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('B2C-Fun SQLite database initialized.');

export default db;
