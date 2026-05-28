/**
 * Database adapter — uses Mongoose (MongoDB) when available,
 * falls back to NeDB (file-based, zero external dependencies).
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

let Datastore = null;
try { Datastore = require('nedb-promises'); } catch { }

const DATA_DIR = path.join(__dirname, '..', 'data');

// ── NeDB Adapter ──────────────────────────────────────────
class NeDBCollection {
  constructor(name) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.name = name;
    this.store = Datastore
      ? Datastore.create({ filename: path.join(DATA_DIR, `${name}.db`), autoload: true })
      : null;
    this._docs = [];
    this._idSeq = 1;
  }

  _id(doc) { return doc && doc._id ? doc._id.toString() : null; }

  _wrap(doc) {
    if (!doc) return null;
    const d = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    d._id = d._id ? d._id.toString() : d._id;
    d.id = d._id;
    return d;
  }

  _wrapAll(docs) { return docs.map(d => this._wrap(d)); }

  _match(doc, filter) {
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        const ok = v.some((sub) => this._match(doc, sub));
        if (!ok) return false;
        continue;
      }
      if (k === '$and') {
        const ok = v.every((sub) => this._match(doc, sub));
        if (!ok) return false;
        continue;
      }
      const val = doc[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [op, opVal] of Object.entries(v)) {
          if (op === '$ne' && val === opVal) return false;
          if (op === '$gt' && !(val > opVal)) return false;
          if (op === '$gte' && !(val >= opVal)) return false;
          if (op === '$lt' && !(val < opVal)) return false;
          if (op === '$lte' && !(val <= opVal)) return false;
          if (op === '$in' && !(opVal.includes(val))) return false;
          if (op === '$nin' && opVal.includes(val)) return false;
          if (op === '$regex' && !new RegExp(opVal, 'i').test(String(val))) return false;
        }
      } else if (val !== v) {
        return false;
      }
    }
    return true;
  }

  _applySort(docs, sort) {
    if (!sort) return docs;
    const key = Object.keys(sort)[0];
    const dir = sort[key];
    return [...docs].sort((a, b) => (a[key] > b[key] ? 1 : -1) * dir);
  }

  async find(filter = {}, opts = {}) {
    if (this.store) {
      let docs = await this.store.find(filter);
      if (opts.sort) docs = this._applySort(docs, opts.sort);
      if (opts.skip) docs = docs.slice(opts.skip);
      if (opts.limit) docs = docs.slice(0, opts.limit);
      return this._wrapAll(docs);
    }
    let docs = this._docs.filter(d => this._match(d, filter));
    docs = this._applySort(docs, opts.sort);
    if (opts.skip) docs = docs.slice(opts.skip);
    if (opts.limit) docs = docs.slice(0, opts.limit);
    return this._wrapAll(docs);
  }

  async findOne(filter = {}) {
    if (this.store) return this._wrap(await this.store.findOne(filter));
    return this._wrap(this._docs.find(d => this._match(d, filter)) || null);
  }

  async findById(id) {
    return this.findOne({ _id: id });
  }

  async create(data) {
    const now = new Date();
    if (this.store) {
      const doc = { ...data, createdAt: now, updatedAt: now };
      const inserted = await this.store.insert(doc);
      return this._wrap(inserted);
    }
    const doc = { ...data, _id: String(this._idSeq++), createdAt: now, updatedAt: now };
    this._docs.push(doc);
    return this._wrap(doc);
  }

  async findOneAndUpdate(filter, update, opts = {}) {
    if (this.store) {
      const dbUpdate = {};
      if (update.$set) dbUpdate.$set = { ...update.$set, updatedAt: new Date() };
      else dbUpdate.$set = { updatedAt: new Date() };
      if (update.$unset) dbUpdate.$unset = update.$unset;
      if (update.$push) dbUpdate.$push = update.$push;
      if (update.$pull) dbUpdate.$pull = update.$pull;
      const doc = await this.store.update(filter, dbUpdate, { returnUpdatedDocs: true });
      if (Array.isArray(doc)) return this._wrap(doc[1] || doc[0]);
      return this._wrap(doc);
    }
    const idx = this._docs.findIndex(d => this._match(d, filter));
    if (idx === -1) return null;
    const doc = this._docs[idx];
    if (update.$set) Object.assign(doc, update.$set);
    if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
    if (update.$push) for (const [k, v] of Object.entries(update.$push)) {
      if (!doc[k]) doc[k] = []; doc[k].push(v);
    }
    doc.updatedAt = new Date();
    return this._wrap(opts.new !== false ? doc : this._docs[idx]);
  }

  async findByIdAndUpdate(id, update, opts = {}) {
    return this.findOneAndUpdate({ _id: id }, update, opts);
  }

  async countDocuments(filter = {}) {
    if (this.store) return this.store.count(filter);
    return this._docs.filter(d => this._match(d, filter)).length;
  }

  async deleteOne(filter = {}) {
    if (this.store) return this.store.remove(filter, {});
    const idx = this._docs.findIndex(d => this._match(d, filter));
    if (idx !== -1) { this._docs.splice(idx, 1); return 1; }
    return 0;
  }

  async deleteMany(filter = {}) {
    if (this.store) return this.store.remove(filter, { multi: true });
    const before = this._docs.length;
    this._docs = this._docs.filter(d => !this._match(d, filter));
    return before - this._docs.length;
  }

  aggregate(pipeline) {
    return this.store ? this.store.aggregate(pipeline).exec() : Promise.resolve([]);
  }

  distinct(field, filter = {}) {
    return this.find(filter).then(docs => [...new Set(docs.map(d => d[field]))]);
  }
}

// ── Model registry ────────────────────────────────────────
const mongooseModels = {};
const nedbCollections = {};
let useMongoose = false;

function init() {
  useMongoose = mongoose.connection.readyState === 1;
}

function getCollection(name, schema) {
  if (useMongoose) {
    if (!mongooseModels[name]) {
      mongooseModels[name] = mongoose.model(name, schema);
    }
    return mongooseModels[name];
  }
  if (!nedbCollections[name]) {
    nedbCollections[name] = new NeDBCollection(name.toLowerCase());
  }
  return nedbCollections[name];
}

async function connect(uri) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    useMongoose = true;
    console.log('[DB] MongoDB connected');
    return true;
  } catch (err) {
    useMongoose = false;
    console.warn(`[DB] MongoDB unavailable (${err.message}). Using file-based NeDB fallback.`);
    return false;
  }
}

module.exports = { connect, init, getCollection, NeDBCollection };
