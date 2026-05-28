const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const db = require('./db');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const aiModelRoutes = require('./routes/aiModels');
const uploadRoutes = require('./routes/upload');
const { setupWebSocket } = require('./websocket');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : 'http://localhost:4200',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));

app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/models', aiModelRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (_, res) => {
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    status: 'ok',
    db: dbState[require('mongoose').connection.readyState] || 'nedb-fallback',
    storage: 'filesystem',
    timestamp: new Date().toISOString(),
  });
});

setupWebSocket(io);

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cine-remaster';

async function start() {
  if (process.env.MONGODB_URI) {
    await db.connect(MONGODB_URI);
  } else {
    console.log('[DB] No MONGODB_URI set. Using embedded NeDB (file-based) — zero setup required.');
    console.log('[DB] Set MONGODB_URI in backend/.env to use MongoDB instead.');
  }

  httpServer.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║   CineRemaster API                       ║`);
    console.log(`  ║   Port: ${PORT}                               ║`);
    console.log(`  ║   Mode: ${process.env.NODE_ENV || 'development'}                          ║`);
    console.log(`  ║   Storage: ${require('mongoose').connection.readyState === 1 ? 'MongoDB' : 'NeDB (embedded)'}          ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
}

start();

module.exports = { app, httpServer, io };
