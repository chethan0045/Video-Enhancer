/**
 * Seed script — populates AI models if using MongoDB.
 * With NeDB (default fallback), models auto-seed on first access.
 * This script is only needed for MongoDB deployments.
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { AIModel } = require('../src/models');

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cine-remaster';
  try {
    await mongoose.connect(uri);
    console.log('[Seed] Connected to MongoDB');
    await AIModel._seed();
    console.log('[Seed] Models seeded');
    await mongoose.disconnect();
  } catch (err) {
    console.log('[Seed] MongoDB unavailable — models auto-seed with NeDB. No action needed.');
  }
}

seed();
