const jwt = require('jsonwebtoken');
const userSockets = new Map();
let ioInstance = null;

exports.setupWebSocket = (io) => {
  ioInstance = io;
  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.on('authenticate', (token) => {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
        socket.userId = decoded.id;
        userSockets.set(decoded.id, socket.id);
        socket.join(`user:${decoded.id}`);
      } catch {
        socket.emit('error', { message: 'Invalid token' });
      }
    });

    socket.on('subscribe:job', (jobId) => {
      if (socket.userId) socket.join(`job:${jobId}`);
    });

    socket.on('unsubscribe:job', (jobId) => {
      socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', () => {
      if (socket.userId) userSockets.delete(socket.userId);
    });
  });
};

exports.emitJobProgress = (jobId, data) => {
  if (ioInstance) {
    ioInstance.to(`job:${jobId}`).emit('job:progress', { jobId, ...data });
    if (data.userId) {
      ioInstance.to(`user:${data.userId}`).emit('job:update', { jobId, status: data.status, progress: data.progress });
    }
  }
};
