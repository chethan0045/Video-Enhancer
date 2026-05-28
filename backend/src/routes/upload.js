const router = require('express').Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const uploadController = require('../controllers/uploadController');

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE || '2048') || 2048) * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/avi', 'video/mkv', 'video/mov', 'video/x-matroska'];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post('/', auth, upload.single('video'), uploadController.uploadVideo);

module.exports = router;
