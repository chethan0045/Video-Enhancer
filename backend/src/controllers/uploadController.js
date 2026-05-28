const path = require('path');
const fs = require('fs');

const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/avi', 'video/mkv', 'video/mov', 'video/x-matroska'];

exports.uploadVideo = (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!ALLOWED_TYPES.includes(req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `Unsupported format: ${req.file.mimetype}` });
    }
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({
      file: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        path: req.file.path,
        url,
      },
    });
  } catch (err) {
    console.error('[Upload] Error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
};
