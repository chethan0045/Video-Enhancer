const router = require('express').Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/authController');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.get('/profile', auth, ctrl.getProfile);
router.put('/profile', auth, ctrl.updateProfile);

module.exports = router;
