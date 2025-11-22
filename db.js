// server/db.js
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'tremor_db';

let client = null;
let db = null;

async function connect() {
  if (db) return db;
  // Do NOT pass legacy options; modern mongodb driver ignores/throws on them.
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);

  // create helpful indexes if they don't exist
  await db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(()=>{});
  await db.collection('tests').createIndex({ userId: 1, createdAt: -1 }).catch(()=>{});

  return db;
}

function getClient() {
  return client;
}

module.exports = { connect, getClient };
