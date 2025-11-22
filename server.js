// server/server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');
const sharp = require('sharp');
const cors = require('cors');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit (adjust)



// server/server.js  (extend your current server)

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { connect } = require('./db');

const PORT = process.env.PORT || 8000;
const MODEL_FILENAME = process.env.MODEL_FILENAME || 'parkinson_cnn.onnx';
const MODEL_PATH = path.join(__dirname, MODEL_FILENAME);

// JWT secret (set via env in production)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// multer storage for test images (disk storage so files are persistent)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = (file.mimetype && file.mimetype.split('/')[1]) || 'png';
    const name = `test_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    cb(null, name);
  }
});

// Connect to DB
let db;
connect().then(d => { db = d; console.log('Mongo connected'); }).catch(err => {
  console.error('Mongo connection failed', err);
  process.exit(1);
});

// ---------- Simple auth routes ----------
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email & password required' });

    const users = db.collection('users');
    const hashed = await bcrypt.hash(password, 10);
    const user = { email: email.toLowerCase(), password: hashed, name: name || '', createdAt: new Date() };
    await users.insertOne(user);
    // create token
    const token = jwt.sign({ sub: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: { email: user.email, name: user.name } });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already in use' });
    console.error('signup error', err);
    return res.status(500).json({ error: 'signup failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email & password required' });
    const users = db.collection('users');
    const user = await users.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = jwt.sign({ sub: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: { email: user.email, name: user.name } });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'login failed' });
  }
});

// middleware to extract user from Authorization header
function authMiddleware(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr || !hdr.startsWith('Bearer ')) return res.status(401).json({ error: 'missing token' });
  const token = hdr.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// ---------- Tests routes (save + list) ----------
// POST /tests - save a test (image + sensor + model result metadata)
// field 'image' must be multipart file (FormData). Other fields: sensor_csv, age, dominant_hand, result (JSON string)
app.post('/tests', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const tests = db.collection('tests');
    if (!req.file) return res.status(400).json({ error: 'image file (multipart field "image") required' });

    // file saved at uploads/<filename>
    const imagePath = path.join('uploads', req.file.filename); // relative path
    const sensor_csv = req.body.sensor_csv || null;
    const age = req.body.age ? Number(req.body.age) : null;
    const dominant_hand = req.body.dominant_hand || null;
    // result is expected as JSON string from client after inference; parse if present
    let resultObj = null;
    try { resultObj = req.body.result ? JSON.parse(req.body.result) : null; } catch (e) { resultObj = null; }

    const doc = {
      userId: req.user.id,
      imagePath, // relative path to file in server/uploads
      sensor_csv,
      age,
      dominant_hand,
      result: resultObj,
      createdAt: new Date()
    };
    const r = await tests.insertOne(doc);
    return res.json({ ok: true, id: r.insertedId, test: doc });
  } catch (err) {
    console.error('save test failed', err);
    return res.status(500).json({ error: 'save failed' });
  }
});

// GET /tests - list tests for current user (paginated)
app.get('/tests', authMiddleware, async (req, res) => {
  try {
    const tests = db.collection('tests');
    const q = { userId: req.user.id };
    const rows = await tests.find(q).sort({ createdAt: -1 }).limit(200).toArray();
    // For each test, include absolute URL for the image so clients can show it.
    // If you expose the server publicly, construct full URL. For local testing we'll send relative path.
    const host = req.headers.host; // e.g. 'localhost:8000' or ngrok host
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const base = `${proto}://${host}`;
    const payload = rows.map(r => ({
      _id: r._id,
      imageUrl: `${base}/${r.imagePath}`, // e.g. http://host/uploads/xyz.png
      sensor_csv: r.sensor_csv,
      age: r.age,
      dominant_hand: r.dominant_hand,
      result: r.result,
      createdAt: r.createdAt
    }));
    return res.json({ tests: payload });
  } catch (err) {
    console.error('list tests failed', err);
    return res.status(500).json({ error: 'list failed' });
  }
});

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------- Your existing inference endpoints ----------
// Keep your /infer handler (the one that accepts multipart form-data or base64).
// If you want the client to upload the image *and* save automatically, a recommended flow is:
// 1) client POSTs image/result to /tests (multipart) with Authorization header; server saves file + record
// 2) server can optionally run inference (or client runs inference and passes result field). To reuse existing model-run code,
// you can call that inference logic from within the /tests handler (not included here to keep separation). 
//
// Paste your existing inference code here (the /infer route you already have).
// For example:
//
// app.post('/infer', upload.single('image'), async (req, res) => {
//   // existing model run code - run on req.file.buffer or similar
// });

/* ---------- ONNX model loading + previous /infer implementation should remain below ---------- */
/* Keep your model load and /infer route here (unchanged) */

async function initAndListen() {
  try {
    // ensure db is connected
    await connect();
    // load your ONNX model as you already do
    // ... existing loading logic
    app.listen(PORT, () => {
      console.log(`Server listening on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('init error', err);
    process.exit(1);
  }
}
initAndListen();


let session = null;

function softmax(arr) {
  const max = Math.max(...arr);
  const exps = arr.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

function rgbaToFloatCHW(rawRGBA, width, height, options = {}) {
  const hw = width * height;
  const out = new Float32Array(1 * 3 * hw);
  let rIdx = 0, gIdx = hw, bIdx = hw * 2;
  const normalize = options.normalize || '0-1';
  for (let i = 0, px = 0; i < hw; i++, px += 4) {
    const r = rawRGBA[px], g = rawRGBA[px + 1], b = rawRGBA[px + 2];
    if (normalize === 'imagenet') {
      out[rIdx++] = (r / 255 - 0.485) / 0.229;
      out[gIdx++] = (g / 255 - 0.456) / 0.224;
      out[bIdx++] = (b / 255 - 0.406) / 0.225;
    } else {
      out[rIdx++] = r / 255;
      out[gIdx++] = g / 255;
      out[bIdx++] = b / 255;
    }
  }
  return out;
}

async function loadModel() {
  if (!fs.existsSync(MODEL_PATH)) {
    console.error('Model not found at', MODEL_PATH);
    console.error('Put model.onnx (and model.onnx.data if present) into the server/ folder.');
    process.exit(1);
  }
  console.log('Loading ONNX model from', MODEL_PATH);
  session = await ort.InferenceSession.create(MODEL_PATH);
  console.log('Model loaded. Inputs:', session.inputNames, 'Outputs:', session.outputNames);
}

app.get('/', (req, res) => res.send('ONNX inference server ready'));

// SERVER: require multer at top

// Then update the POST route to use multer middleware
app.post('/infer', upload.single('image'), async (req, res) => {
    console.log('>>> /infer HIT (multer)');
    console.log('>>> /infer HIT', { headers: req.headers, contentLength: req.headers['content-length'] });

// multer saved buffer on req.file.buffer (or req.file.path if diskStorage)
if (req.file) {
  console.log('Received file field name:', req.file.fieldname, 'originalname:', req.file.originalname, 'size:', req.file.size);
  // Save copy to debug folder
  const debugPath = path.join(__dirname, 'debug_received', `received_${Date.now()}_${req.file.originalname}`);
  fs.mkdirSync(path.dirname(debugPath), { recursive: true });
  fs.writeFileSync(debugPath, req.file.buffer); // if memoryStorage
  console.log('Saved incoming file to', debugPath);
}
  try {
    if (!session) return res.status(503).json({ error: 'Model not ready' });

    // multer will put file buffer in req.file.buffer
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'image file required as multipart form-data field "image"' });

    // optional sensor CSV comes as text field
    const sensor_csv = req.body.sensor_csv || null;
    const age = req.body.age || null;
    const dominant_hand = req.body.dominant_hand || null;

    const imageBuf = req.file.buffer; // Buffer already

    const WIDTH = 128, HEIGHT = 128;
    const sharpRes = await sharp(imageBuf)
      .resize(WIDTH, HEIGHT, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data: rawRGBA, info } = sharpRes;
    if (!rawRGBA || rawRGBA.length !== WIDTH * HEIGHT * 4) {
      return res.status(500).json({ error: 'Decoded image size mismatch', info });
    }

    const floatData = rgbaToFloatCHW(rawRGBA, WIDTH, HEIGHT, { normalize: '0-1' });
    const inputName = session.inputNames && session.inputNames.length ? session.inputNames[0] : 'input';
    const tensor = new ort.Tensor('float32', floatData, [1, 3, HEIGHT, WIDTH]);

    const feeds = {};
    feeds[inputName] = tensor;
    const results = await session.run(feeds);

    const outNames = Object.keys(results);
    if (!outNames.length) return res.status(500).json({ error: 'Model returned no outputs' });

    const outTensor = results[outNames[0]];
    const outData = Array.from(outTensor.data);

    let decision = null, score = null, probabilities = null;
    if (outData.length === 1) {
      score = outData[0];
      decision = score >= 0.5 ? 'positive' : 'negative';
    } else {
      probabilities = softmax(outData);
      let maxI = 0;
      for (let i = 1; i < probabilities.length; i++) if (probabilities[i] > probabilities[maxI]) maxI = i;
      const labels = ['no_tremor', 'tremor'];
      decision = labels[maxI] || `class_${maxI}`;
      score = probabilities[maxI];
    }

    let sensorSummary = null;
    if (sensor_csv) {
      const rows = sensor_csv.split(/\r?\n/).filter(Boolean);
      sensorSummary = { rows: Math.max(0, rows.length - 1) };
    }

    return res.json({
      decision,
      score,
      probabilities,
      rawOutput: outData.slice(0, 100),
      sensorSummary,
      modelMeta: { inputName, outputName: outNames[0], inputShape: tensor.dims },
    });
  } catch (err) {
    console.error('Inference error (multer):', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

loadModel()
  .then(() => {
    app.listen(PORT, () => console.log(`Server listening on http://0.0.0.0:${PORT}`));
  })
  .catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
