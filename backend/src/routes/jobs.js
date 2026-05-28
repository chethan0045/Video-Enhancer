const router = require('express').Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const jobController = require('../controllers/jobController');

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
    const ext = path.extname(file.originalname).toLowerCase();
    const videoExts = ['.mp4', '.webm', '.avi', '.mkv', '.mov', '.mts', '.m2ts', '.ts', '.m4v', '.3gp', '.wmv', '.flv'];
    const videoMimes = ['video/', 'application/vnd.apple', 'application/mp4'];
    const isVideo = videoExts.includes(ext) || videoMimes.some(m => file.mimetype.startsWith(m));
    cb(null, isVideo);
  },
});

router.get('/', auth, jobController.listJobs);
router.post('/', auth, upload.single('video'), jobController.createJob);
router.get('/:id', auth, jobController.getJob);
router.put('/:id/cancel', auth, jobController.cancelJob);
router.put('/:id/pipeline', auth, jobController.updatePipeline);
router.put('/:id/retry', auth, jobController.retryJob);
router.delete('/:id', auth, jobController.deleteJob);

module.exports = router;
