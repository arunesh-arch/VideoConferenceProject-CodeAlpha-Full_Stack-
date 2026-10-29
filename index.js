
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';
import multer from 'multer';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import './database.js';
import bcrypt from 'bcrypt';
import session from 'express-session';
import db from './database.js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

const io = new Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
    ],
    methods: ['GET', 'POST'],
  },
});

app.use(express.json());

const FRONTEND_URL = 'http://localhost:5173';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(session({
  name: 'meetspace.sid',
  secret: process.env.SESSION_SECRET || 'local-development-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // Local HTTP development only.
    maxAge: 1000 * 60 * 60 * 8,
  },
}));


function isMeetingParticipant(meetingId, socketId) {
  const id = String(meetingId || '').trim().toLowerCase();
  const room = rooms.get(id);

  return Boolean(
    room?.has(socketId) &&
    io.sockets.sockets.get(socketId)?.rooms.has(id)
  );
}

app.post('/api/meetings/:meetingId/files', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        error: err.message || 'File upload failed.',
      });
    }

    const meetingId = String(req.params.meetingId || '').toLowerCase();
    const socketId = String(req.body.socketId || '');

    if (!isMeetingParticipant(meetingId, socketId)) {
      if (req.file) {
        const { unlink } = await import('node:fs/promises');
        await unlink(req.file.path).catch(() => {});
      }

      return res.status(403).json({ error: 'You are not in this meeting.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Choose a file first.' });
    }

    const fileId = randomBytes(16).toString('hex');

    const fileInfo = {
      id: fileId,
      meetingId,
      name: path.basename(req.file.originalname),
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
      path: req.file.path,
    };

    sharedFiles.set(fileId, fileInfo);

    const { path: storedPath, ...publicInfo } = fileInfo;

    io.to(meetingId).emit('file-shared', publicInfo);

    res.status(201).json(publicInfo);
  });
});

app.get('/api/meetings/:meetingId/files/:fileId', async (req, res) => {
  const meetingId = String(req.params.meetingId || '').toLowerCase();
  const socketId = String(req.query.socketId || '');

  if (!isMeetingParticipant(meetingId, socketId)) {
    return res.status(403).json({ error: 'You are not in this meeting.' });
  }

  const file = sharedFiles.get(req.params.fileId);

  if (!file || file.meetingId !== meetingId) {
    return res.status(404).json({ error: 'File not found.' });
  }

  try {
    await stat(file.path);
    res.download(file.path, file.name);
  } catch {
    res.status(404).json({ error: 'The stored file is unavailable.' });
  }
});
// Backend health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'B2C-Fun backend is running',
  });
});

// Temporary in-memory meeting storage
const rooms = new Map();
const uploadDir = path.resolve('uploads');
await mkdir(uploadDir, { recursive: true });

const sharedFiles = new Map();

const allowedTypes = new Set([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, callback) => {
      callback(null, `${randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) {
      return callback(new Error('Only PDF, TXT, PNG, and JPEG files are allowed.'));
    }

    callback(null, true);
  },
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Check whether the current browser has a logged-in user.
app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  res.json({ user: req.session.user });
});

// Register a new account.
app.post('/api/auth/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (username.length < 2 || username.length > 40) {
      return res.status(400).json({
        error: 'Username must be 2–40 characters.',
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and no more than 72 bytes.',
      });
    }

    const existing = db.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).get(email);

    if (existing) {
      return res.status(409).json({
        error: 'An account with this email already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?)
    `).run(username, email, passwordHash);

    req.session.user = {
      id: Number(result.lastInsertRowid),
      username,
      email,
    };

    req.session.save((err) => {
      if (err) {
        console.error('Session save failed:', err);
        return res.status(500).json({ error: 'Could not create session.' });
      }

      res.status(201).json({ user: req.session.user });
    });
  } catch (err) {
    console.error('Registration failed:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// Log in to an existing account.
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    const user = db.prepare(`
      SELECT id, username, email, password_hash
      FROM users
      WHERE email = ?
    `).get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: 'Invalid email or password.',
      });
    }

    // Regenerate the session after successful authentication.
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration failed:', err);
        return res.status(500).json({ error: 'Could not create session.' });
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email,
      };

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save failed:', saveErr);
          return res.status(500).json({ error: 'Could not create session.' });
        }

        res.json({ user: req.session.user });
      });
    });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// Log out and destroy the current session.
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out.' });
    }

    res.clearCookie('meetspace.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    });

    res.json({ ok: true });
  });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

    // Shared whiteboard: relay drawing strokes to meeting participants.
  socket.on('whiteboard-stroke', ({ meetingId, stroke } = {}) => {
    const id = String(meetingId || '').trim().toLowerCase();
    const room = rooms.get(id);

    if (!room?.has(socket.id) || !stroke) return;

    socket.to(id).emit('whiteboard-stroke', {
      meetingId: id,
      stroke,
    });
  });

  // Clear the shared whiteboard for everyone in the meeting.
  socket.on('whiteboard-clear', ({ meetingId } = {}) => {
    const id = String(meetingId || '').trim().toLowerCase();
    const room = rooms.get(id);

    if (!room?.has(socket.id)) return;

    socket.to(id).emit('whiteboard-clear', {
      meetingId: id,
    });
  });
  socket.on('create-meeting', (callback) => {
    const meetingId = randomBytes(4).toString('hex');

    const participant = {
        id: socket.id,
  name: 'Participant 1',
  mediaReady: false,
};

    rooms.set(meetingId, new Map([[socket.id, participant]]));
    socket.join(meetingId);

    callback?.({
      ok: true,
      meetingId,
      participants: [...rooms.get(meetingId).values()],
    });

    console.log('Meeting created:', meetingId);
  });

  socket.on('join-meeting', ({ meetingId } = {}, callback) => {
    const id = String(meetingId || '').trim().toLowerCase();
    const room = rooms.get(id);

    if (!room) {
      callback?.({
        ok: false,
        error: 'Meeting not found. Check the ID or create a new meeting.',
      });
      return;
    }

    if (room.has(socket.id)) {
      callback?.({
        ok: true,
        meetingId: id,
        participants: [...room.values()],
      });
      return;
    }

    const participant = {
  id: socket.id,
  name: `Participant ${room.size + 1}`,
  mediaReady: false,
};

    socket.join(id);
    room.set(socket.id, participant);

    socket.to(id).emit('participant-joined', participant);

    callback?.({
      ok: true,
      meetingId: id,
      participants: [...room.values()],
    });

    console.log(`${socket.id} joined meeting ${id}`);
  });

  
  socket.on('leave-meeting', ({ meetingId } = {}) => {
    leaveMeeting(socket, meetingId);
  });

  
socket.on('media-ready', ({ meetingId } = {}) => {
  const id = String(meetingId || '').trim().toLowerCase();
  const room = rooms.get(id);
  const participant = room?.get(socket.id);

  if (!participant) return;

  participant.mediaReady = true;

  io.to(id).emit('participant-media-ready', {
    id: socket.id,
  });
});

socket.on('media-not-ready', ({ meetingId } = {}) => {
  const id = String(meetingId || '').trim().toLowerCase();
  const room = rooms.get(id);
  const participant = room?.get(socket.id);

  if (!participant) return;

  participant.mediaReady = false;

  io.to(id).emit('participant-media-not-ready', {
    id: socket.id,
  });
});


  // WebRTC signaling: forward offers, answers, and ICE candidates.
  function relayToParticipant(eventName, { meetingId, targetId, data } = {}) {
    const id = String(meetingId || '').trim().toLowerCase();
    const room = rooms.get(id);

    // Both participants must belong to the same meeting.
    if (
      !room ||
      !room.has(socket.id) ||
      !room.has(targetId) ||
      socket.id === targetId
    ) {
      return;
    }

    io.to(targetId).emit(eventName, {
      meetingId: id,
      from: socket.id,
      data,
    });
  }

  socket.on('webrtc-offer', (payload) => {
    relayToParticipant('webrtc-offer', payload);
  });

  socket.on('webrtc-answer', (payload) => {
    relayToParticipant('webrtc-answer', payload);
  });

  socket.on('webrtc-ice-candidate', (payload) => {
    relayToParticipant('webrtc-ice-candidate', payload);
  });

  // Keep the existing disconnect handler.
  socket.on('disconnect', () => {
    for (const meetingId of rooms.keys()) {
      leaveMeeting(socket, meetingId);
    }

    console.log('Client disconnected:', socket.id);
  }); });

function leaveMeeting(socket, meetingId) {
  const id = String(meetingId || '').trim().toLowerCase();
  const room = rooms.get(id);

  if (!room || !room.has(socket.id)) {
    return;
  }

  room.delete(socket.id);
  socket.leave(id);

  io.to(id).emit('participant-left', {
    id: socket.id,
  });

  if (room.size === 0) {
    rooms.delete(id);
  }

  console.log(`${socket.id} left meeting ${id}`);
}

httpServer.listen(PORT, () => {
  console.log(`B2C-Fun backend running at http://localhost:${PORT}`);
});
