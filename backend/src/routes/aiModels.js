const router = require('express').Router();
const auth = require('../middleware/auth');
const aiModelController = require('../controllers/aiModelController');

router.get('/', auth, aiModelController.getModels);
router.get('/:id', auth, aiModelController.getModel);

module.exports = router;
