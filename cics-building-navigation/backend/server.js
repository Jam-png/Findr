require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');
const { sendFindrEmail, sendReportNotification } = require('./email');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-before-deploying');
const ADMIN_REGISTRATION_CODE = process.env.ADMIN_REGISTRATION_CODE || '';
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'report-images';
const TOKEN_COOKIE = 'findr_token';
const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed.'));
  }
});

const publicUser = user => ({
  id: user.id,
  full_name: user.full_name,
  username: user.username,
  email: user.email,
  role: user.role
});

function sendCookie(res, user) {
  const token = jwt.sign({ sub: String(user.id) }, JWT_SECRET, { expiresIn: TOKEN_LIFETIME_SECONDS });
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TOKEN_LIFETIME_SECONDS * 1000,
    path: '/'
  });
}

async function attachUser(req, _res, next) {
  try {
    const token = req.cookies[TOKEN_COOKIE];
    if (!token) { req.user = null; return next(); }
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data, error } = await db.from('users')
      .select('id,full_name,username,email,role')
      .eq('id', decoded.sub)
      .maybeSingle();
    if (error) throw error;
    req.user = data || null;
    next();
  } catch (_error) {
    req.user = null;
    next();
  }
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin')
    return res.status(403).json({ error: 'Administrator access required.' });
  next();
}
function failIfError(result) {
  if (result.error) throw result.error;
  return result.data;
}
function optionalId(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// Express serves public/ locally. Vercel serves files in public/ from its static CDN.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(attachUser);

app.get('/api/health', async (_req, res) => {
  try {
    const { error } = await db.from('buildings').select('id', { head: true, count: 'exact' });
    if (error) throw error;
    res.json({ ok: true, service: 'Findr API', database: 'connected' });
  } catch (error) {
    console.error('[Findr health check]', error);
    res.status(503).json({ ok: false, service: 'Findr API', database: 'unavailable' });
  }
});

// Admin-only integration diagnostics. Never returns credentials or secret values.
app.get('/api/integrations/status', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const { error } = await db.from('buildings').select('id', { head: true, count: 'exact' });
    if (error) throw error;
    res.json({
      database: 'connected',
      imageStorage: STORAGE_BUCKET,
      emailNotifications: process.env.RESEND_API_KEY && process.env.EMAIL_FROM ? 'configured' : 'not configured'
    });
  } catch (error) { next(error); }
});

// Authentication
app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const { full_name, username, email, password, role = 'student', admin_code } = req.body;
    if (!full_name || !username || !email || !password)
      return res.status(400).json({ error: 'Please complete all required fields.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Enter a valid email address.' });
    if (String(password).length < 8)
      return res.status(400).json({ error: 'Password must contain at least 8 characters.' });
    if (!['student', 'admin'].includes(role))
      return res.status(400).json({ error: 'Invalid account type.' });
    if (role === 'admin' && (!ADMIN_REGISTRATION_CODE || admin_code !== ADMIN_REGISTRATION_CODE))
      return res.status(403).json({ error: 'Invalid administrator registration code.' });

    const password_hash = await bcrypt.hash(password, 12);
    const cleanEmail = String(email).trim().toLowerCase();
    const data = failIfError(await db.from('users').insert({
      full_name: String(full_name).trim(),
      username: String(username).trim(),
      email: cleanEmail,
      password_hash,
      role
    }).select('id,full_name,email,role').single());

    // Registration is immediate; no email verification or Resend delivery is required.
    res.status(201).json({
      message: 'Account created successfully. You can now log in.',
      id: data.id
    });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Username or email already exists.' });
    next(error);
  }
});

// Email-based password recovery is currently unavailable because no email
// delivery provider is configured. Never reset a password based only on an
// email address; that would allow anyone to take over another user's account.
app.post('/api/auth/forgot-password', authLimiter, (_req, res) => {
  res.status(503).json({
    error: 'Password recovery by email is temporarily unavailable. Please contact the Findr administrator for assistance.'
  });
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const { identifier, password, role } = req.body;
    if (!identifier || !password || !['student', 'admin'].includes(role))
      return res.status(400).json({ error: 'Enter your login details and account type.' });

    let user = failIfError(await db.from('users').select('*').eq('username', String(identifier).trim()).eq('role', role).maybeSingle());
    if (!user) user = failIfError(await db.from('users').select('*').eq('email', String(identifier).trim().toLowerCase()).eq('role', role).maybeSingle());
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Incorrect login details or account type.' });

    sendCookie(res, user);
    res.json({ message: 'Login successful.', user: publicUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(TOKEN_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
  res.json({ message: 'Logged out.' });
});
app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

// Building directory
app.get('/api/buildings', async (_req, res, next) => {
  try { res.json(failIfError(await db.from('buildings').select('*').order('building_name'))); }
  catch (error) { next(error); }
});
app.get('/api/floors', async (req, res, next) => {
  try {
    let query = db.from('floors').select('*').order('floor_number');
    if (req.query.building_id) query = query.eq('building_id', req.query.building_id);
    res.json(failIfError(await query));
  } catch (error) { next(error); }
});
app.get('/api/rooms', async (req, res, next) => {
  try {
    const [roomRows, floorRows, buildingRows] = await Promise.all([
      db.from('rooms').select('*'),
      db.from('floors').select('id,floor_number,floor_name,building_id'),
      db.from('buildings').select('id,building_name')
    ]);
    const roomData = failIfError(roomRows);
    const floorData = failIfError(floorRows);
    const buildingData = failIfError(buildingRows);
    const floorMap = new Map(floorData.map(f => [String(f.id), f]));
    const buildingMap = new Map(buildingData.map(b => [String(b.id), b]));
    let rooms = roomData.map(room => {
      const floor = floorMap.get(String(room.floor_id));
      const building = floor ? buildingMap.get(String(floor.building_id)) : null;
      return { ...room, floor_number: floor?.floor_number ?? null, floor_name: floor?.floor_name ?? '', building_name: building?.building_name ?? '' };
    });
    if (req.query.floor_id) rooms = rooms.filter(r => String(r.floor_id) === String(req.query.floor_id));
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      rooms = rooms.filter(r => `${r.room_name} ${r.room_number} ${r.room_type}`.toLowerCase().includes(q));
    }
    rooms.sort((a, b) => (a.floor_number - b.floor_number) || String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }));
    res.json(rooms);
  } catch (error) { next(error); }
});

// Administrator-only directory CRUD
app.post('/api/buildings', requireAdmin, async (req, res, next) => {
  try {
    const { building_name, description, location } = req.body;
    if (!building_name) return res.status(400).json({ error: 'Building name is required.' });
    const row = failIfError(await db.from('buildings').insert({ building_name, description: description || null, location: location || null }).select('id').single());
    res.status(201).json({ id: row.id, message: 'Building added.' });
  } catch (error) { next(error); }
});
app.put('/api/buildings/:id', requireAdmin, async (req, res, next) => {
  try {
    const { building_name, description, location } = req.body;
    const row = failIfError(await db.from('buildings').update({ building_name, description: description || null, location: location || null }).eq('id', req.params.id).select('id').maybeSingle());
    if (!row) return res.status(404).json({ error: 'Building not found.' });
    res.json({ message: 'Building updated.' });
  } catch (error) { next(error); }
});
app.delete('/api/buildings/:id', requireAdmin, async (req, res, next) => {
  try {
    const row = failIfError(await db.from('buildings').delete().eq('id', req.params.id).select('id').maybeSingle());
    if (!row) return res.status(404).json({ error: 'Building not found.' });
    res.json({ message: 'Building deleted.' });
  } catch (error) { next(error); }
});
app.post('/api/floors', requireAdmin, async (req, res, next) => {
  try {
    const { building_id, floor_number, floor_name } = req.body;
    if (!building_id || floor_number === undefined) return res.status(400).json({ error: 'Building and floor number are required.' });
    const row = failIfError(await db.from('floors').insert({ building_id, floor_number, floor_name: floor_name || `Floor ${floor_number}` }).select('id').single());
    res.status(201).json({ id: row.id, message: 'Floor added.' });
  } catch (error) { next(error); }
});
app.put('/api/floors/:id', requireAdmin, async (req, res, next) => {
  try {
    const { building_id, floor_number, floor_name } = req.body;
    const row = failIfError(await db.from('floors').update({ building_id, floor_number, floor_name }).eq('id', req.params.id).select('id').maybeSingle());
    if (!row) return res.status(404).json({ error: 'Floor not found.' });
    res.json({ message: 'Floor updated.' });
  } catch (error) { next(error); }
});
app.delete('/api/floors/:id', requireAdmin, async (req, res, next) => {
  try {
    const row = failIfError(await db.from('floors').delete().eq('id', req.params.id).select('id').maybeSingle());
    if (!row) return res.status(404).json({ error: 'Floor not found.' });
    res.json({ message: 'Floor deleted.' });
  } catch (error) { next(error); }
});
app.post('/api/rooms', requireAdmin, async (req, res, next) => {
  try {
    const { floor_id, room_name, room_number, room_type, description } = req.body;
    if (!floor_id || !room_name || !room_number) return res.status(400).json({ error: 'Floor, room name, and room number are required.' });
    const row = failIfError(await db.from('rooms').insert({ floor_id, room_name, room_number, room_type: room_type || 'Classroom', description: description || null }).select('id').single());
    res.status(201).json({ id: row.id, message: 'Room added.' });
  } catch (error) { next(error); }
});
app.put('/api/rooms/:id', requireAdmin, async (req, res, next) => {
  try {
    const { floor_id, room_name, room_number, room_type, description } = req.body;
    const row = failIfError(await db.from('rooms').update({ floor_id, room_name, room_number, room_type, description: description || null }).eq('id', req.params.id).select('id').maybeSingle());
    if (!row) return res.status(404).json({ error: 'Room not found.' });
    res.json({ message: 'Room updated.' });
  } catch (error) { next(error); }
});
app.delete('/api/rooms/:id', requireAdmin, async (req, res, next) => {
  try {
    const row = failIfError(await db.from('rooms').delete().eq('id', req.params.id).select('id').maybeSingle());
    if (!row) return res.status(404).json({ error: 'Room not found.' });
    res.json({ message: 'Room deleted.' });
  } catch (error) { next(error); }
});

// Reports and private image attachments
app.get('/api/reports', requireAuth, async (req, res, next) => {
  try {
    let query = db.from('reports').select('*').order('created_at', { ascending: false });
    if (req.user.role !== 'admin') query = query.eq('user_id', req.user.id);
    const reports = failIfError(await query);
    const [usersResult, buildingsResult, roomsResult] = await Promise.all([
      db.from('users').select('id,full_name'),
      db.from('buildings').select('id,building_name'),
      db.from('rooms').select('id,room_name')
    ]);
    const users = new Map(failIfError(usersResult).map(x => [String(x.id), x]));
    const buildings = new Map(failIfError(buildingsResult).map(x => [String(x.id), x]));
    const rooms = new Map(failIfError(roomsResult).map(x => [String(x.id), x]));
    const output = await Promise.all(reports.map(async report => {
      let image_url = null;
      if (report.image_path) {
        const signed = await db.storage.from(STORAGE_BUCKET).createSignedUrl(report.image_path, 60 * 60);
        if (!signed.error) image_url = signed.data.signedUrl;
      }
      return {
        ...report,
        full_name: users.get(String(report.user_id))?.full_name || '',
        building_name: buildings.get(String(report.building_id))?.building_name || '',
        room_name: rooms.get(String(report.room_id))?.room_name || '',
        image_url
      };
    }));
    res.json(output);
  } catch (error) { next(error); }
});

app.post('/api/reports', requireAuth, upload.single('image'), async (req, res, next) => {
  let uploadedPath = null;
  try {
    const { building_id, room_id, category, priority, title, description, contact_name, contact_email } = req.body;
    if (!category || !title || !description)
      return res.status(400).json({ error: 'Category, title, and description are required.' });
    if (contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email))
      return res.status(400).json({ error: 'Enter a valid contact email address.' });
    const allowedPriorities = ['Low', 'Medium', 'High', 'Urgent'];
    if (priority && !allowedPriorities.includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });

    if (req.file) {
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[req.file.mimetype];
      uploadedPath = `${req.user.id}/${Date.now()}-${require('crypto').randomBytes(8).toString('hex')}.${ext}`;
      const uploadResult = await db.storage.from(STORAGE_BUCKET).upload(uploadedPath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
      if (uploadResult.error) throw uploadResult.error;
    }

    const row = failIfError(await db.from('reports').insert({
      user_id: req.user.id,
      building_id: optionalId(building_id),
      room_id: optionalId(room_id),
      category,
      priority: priority || 'Medium',
      title,
      description,
      image_path: uploadedPath,
      contact_name: contact_name || req.user.full_name,
      contact_email: contact_email || req.user.email
    }).select('id').single());
    const notificationEmail = contact_email || req.user.email;
    const emailResult = await sendReportNotification({
      to: notificationEmail,
      subject: `Findr received your report: ${title}`,
      heading: 'Your report has been received',
      message: `Your report “${title}” has been submitted successfully. You can sign in to Findr to track its status.`,
      details: `Category: ${category} · Priority: ${priority || 'Medium'}`
    });
    res.status(201).json({
      message: 'Your report has been submitted.',
      id: row.id,
      notification: emailResult.sent ? 'sent' : emailResult.reason
    });
  } catch (error) {
    if (uploadedPath) await db.storage.from(STORAGE_BUCKET).remove([uploadedPath]).catch(() => {});
    next(error);
  }
});

app.patch('/api/reports/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['Submitted', 'Under Review', 'In Progress', 'Resolved', 'Rejected'];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid report status.' });
    const existing = failIfError(await db.from('reports').select('id,title,contact_email,status').eq('id', req.params.id).maybeSingle());
    if (!existing) return res.status(404).json({ error: 'Report not found.' });
    const row = failIfError(await db.from('reports').update({ status: req.body.status }).eq('id', req.params.id).select('id').maybeSingle());
    if (!row) return res.status(404).json({ error: 'Report not found.' });
    const emailResult = await sendReportNotification({
      to: existing.contact_email,
      subject: `Findr report update: ${existing.title}`,
      heading: 'Your report status has changed',
      message: `The status of your report “${existing.title}” is now ${req.body.status}.`,
      details: `Previous status: ${existing.status} · New status: ${req.body.status}`
    });
    res.json({ message: 'Report status updated.', notification: emailResult.sent ? 'sent' : emailResult.reason });
  } catch (error) { next(error); }
});

app.get('/api/dashboard/stats', requireAuth, async (req, res, next) => {
  try {
    const [roomCount, floorCount, reportCount] = await Promise.all([
      db.from('rooms').select('id', { count: 'exact', head: true }),
      db.from('floors').select('id', { count: 'exact', head: true }),
      (() => {
        let q = db.from('reports').select('id', { count: 'exact', head: true });
        if (req.user.role !== 'admin') q = q.eq('user_id', req.user.id);
        return q;
      })()
    ]);
    if (roomCount.error) throw roomCount.error;
    if (floorCount.error) throw floorCount.error;
    if (reportCount.error) throw reportCount.error;
    res.json({ rooms: roomCount.count || 0, floors: floorCount.count || 0, reports: reportCount.count || 0 });
  } catch (error) { next(error); }
});

app.use((err, _req, res, _next) => {
  console.error('[Findr API]', err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  if (err.message && err.message.startsWith('Only JPG')) return res.status(400).json({ error: err.message });
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'Unexpected server error. Check the server logs and environment settings.' : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Findr running at http://localhost:${PORT}`));
}

module.exports = app;
