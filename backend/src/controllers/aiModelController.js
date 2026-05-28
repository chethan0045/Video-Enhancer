const { AIModel } = require('../models');

exports.getModels = async (req, res) => {
  try {
    const models = await AIModel.list(req.query.category);
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
};

exports.getModel = async (req, res) => {
  try {
    const model = await AIModel.findById(req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json({ model });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch model' });
  }
};
