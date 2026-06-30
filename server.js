// ============================================================
//  VagueTV — Backend API (Node.js / Express / MySQL)
//  Package : com.veriegile.vaguetv
//  Fichier  : server.js
// ============================================================

import 'dotenv/config';
import cors           from 'cors';
import express        from 'express';
import mysql          from 'mysql2/promise';

import bcrypt         from 'bcryptjs';
import jwt            from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import path from 'path';
import { fileURLToPath } from 'url';
import { OAuth2Client } from 'google-auth-library';

 


const app = express();
app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'Authorization', 'x-client-type'],
}));
app.use(express.json());

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Configuration ────────────────────────────────────────────
const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASS     || '',
  database: process.env.DB_NAME     || 'vaguetv',
  waitForConnections: true,
  connectionLimit:    10,
};

const JWT_SECRET        = process.env.JWT_SECRET        || 'CHANGE_ME_IN_PROD';
const JWT_EXPIRES_IN    = process.env.JWT_EXPIRES_IN    || '7d';
const STORE_CLIENT_KEY  = process.env.STORE_CLIENT_KEY  || 'STORE_BUILD_TOKEN_2024';
// Ce header est envoyé UNIQUEMENT par la version compilée pour le Store.
// La version APK directe ne l'envoie jamais.
const STORE_HEADER      = 'x-client-type'; // valeur attendue : "store"

const pool = mysql.createPool(DB_CONFIG);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/public', express.static(path.join(__dirname, 'public')));
// ── Middlewares ──────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token admin manquant.' });
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé.' });
    }
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token admin invalide ou expiré.' });
  }
}

/**
 * Vérifie le JWT et attache req.user
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
    req.user = payload; // { id, email, is_premium }
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

/**
 * Détermine si la requête provient de la version Store.
 * Ajoute req.isStoreVersion = true/false
 */
function detectClientType(req, _res, next) {
  req.isStoreVersion = req.headers[STORE_HEADER] === 'store';
  next();
}

app.get('/', (_req, res) => res.json({ status: 'VagueTV API ✅' }));

// ── Routes d'authentification ────────────────────────────────

// ── Route : Servir le panel admin ─────────────────────────────
// Accessible sur : http://votre-ip:3000/admin
 
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
 
// ── API Admin : GET toutes les chaînes (avec stream_url) ──────
 
app.get('/admin/api/channels', requireAdmin, async (req, res) => {
  try {
    const [channels] = await pool.execute(
      'SELECT * FROM channels ORDER BY sort_order ASC, id ASC'
    );
    return res.json({ channels });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});
 
// ── API Admin : POST ajouter une chaîne ───────────────────────
 
app.post('/admin/api/channels', requireAdmin, async (req, res) => {
  const { name, category, stream_url, thumbnail_url,
          is_premium_only, is_safe_for_store, is_active, sort_order } = req.body;
 
  if (!name || !category) {
    return res.status(400).json({ error: 'name et category sont obligatoires.' });
  }
 
  try {
    const [result] = await pool.execute(
      `INSERT INTO channels
        (name, category, stream_url, thumbnail_url, is_premium_only, is_safe_for_store, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, category,
        stream_url || null,
        thumbnail_url || null,
        is_premium_only ? 1 : 0,
        is_safe_for_store !== false ? 1 : 0,
        is_active !== false ? 1 : 0,
        sort_order || 0,
      ]
    );
    return res.status(201).json({ message: 'Chaîne créée.', id: result.insertId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});
 
// ── API Admin : PUT modifier une chaîne ──────────────────────
 
app.put('/admin/api/channels/:id', requireAdmin, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (isNaN(channelId)) return res.status(400).json({ error: 'ID invalide.' });
 
  const { name, category, stream_url, thumbnail_url,
          is_premium_only, is_safe_for_store, is_active, sort_order } = req.body;
 
  try {
    await pool.execute(
      `UPDATE channels SET
        name=?, category=?, stream_url=?, thumbnail_url=?,
        is_premium_only=?, is_safe_for_store=?, is_active=?, sort_order=?
       WHERE id=?`,
      [
        name, category,
        stream_url || null,
        thumbnail_url || null,
        is_premium_only ? 1 : 0,
        is_safe_for_store !== false ? 1 : 0,
        is_active !== false ? 1 : 0,
        sort_order || 0,
        channelId,
      ]
    );
    return res.json({ message: 'Chaîne modifiée.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});
 
// ── API Admin : DELETE supprimer une chaîne ───────────────────
 
app.delete('/admin/api/channels/:id', requireAdmin, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (isNaN(channelId)) return res.status(400).json({ error: 'ID invalide.' });
 
  try {
    await pool.execute('DELETE FROM channels WHERE id=?', [channelId]);
    return res.json({ message: 'Chaîne supprimée.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});
 
// ── API Admin : Login admin (retourne token de session) ───────
 
app.post('/admin/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  // Token admin signé avec JWT
  const adminToken = jwt.sign(
    { role: 'admin', username },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  return res.json({ token: adminToken });
});

/**
 * POST /api/auth/register
 */
app.post(
  '/api/auth/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const hash = await bcrypt.hash(password, 12);
      const [result] = await pool.execute(
        'INSERT INTO users (email, password) VALUES (?, ?)',
        [email, hash]
      );
      return res.status(201).json({ message: 'Compte créé.', userId: result.insertId });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY')
        return res.status(409).json({ error: 'Email déjà utilisé.' });
      console.error(err);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

/**
 * POST /api/auth/login
 */
app.post(
  '/api/auth/login',
  [body('email').isEmail(), body('password').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const [rows] = await pool.execute(
        'SELECT id, email, password, is_premium FROM users WHERE email = ?',
        [email]
      );
      const user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password)))
        return res.status(401).json({ error: 'Identifiants incorrects.' });

      const token = jwt.sign(
        { id: user.id, email: user.email, is_premium: !!user.is_premium },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      return res.json({ token, is_premium: !!user.is_premium });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

/**
 * POST /api/auth/google
 * Body: { id_token: "..." }
 */
app.post('/api/auth/google', async (req, res) => {
  const { id_token } = req.body;
  if (!id_token) return res.status(400).json({ error: 'id_token requis.' });

  try {
    // 1. Vérifier le token Google
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { email, sub: google_id, name, picture } = ticket.getPayload();

    // 2. Chercher ou créer l'utilisateur
    const [rows] = await pool.execute(
      'SELECT id, email, is_premium FROM users WHERE email = ?',
      [email]
    );

    let userId, isPremium;

    if (rows.length > 0) {
      // Utilisateur existant → on met à jour google_id si besoin
      userId    = rows[0].id;
      isPremium = rows[0].is_premium;
      await pool.execute(
        'UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?',
        [google_id, picture, userId]
      );
    } else {
      // Nouvel utilisateur → pas de mot de passe (NULL)
      const [result] = await pool.execute(
        'INSERT INTO users (email, google_id, avatar_url, password) VALUES (?, ?, ?, NULL)',
        [email, google_id, picture]
      );
      userId    = result.insertId;
      isPremium = false;
    }

    // 3. Retourner le même JWT que /api/auth/login
    const token = jwt.sign(
      { id: userId, email, is_premium: !!isPremium },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return res.json({ token, is_premium: !!isPremium });

  } catch (err) {
    console.error('Google Auth error:', err);
    return res.status(401).json({ error: 'Token Google invalide.' });
  }
});

// ── Route principale : GET /api/channels ────────────────────

/**
 * GET /api/channels
 *
 * Headers attendus :
 *   Authorization : Bearer <jwt>
 *   x-client-type : "store"   (optionnel, version Play Store uniquement)
 *
 * Logique :
 *  1. Authentification obligatoire (JWT).
 *  2. Si x-client-type === "store" → filtrer is_safe_for_store = 1 (pas de 18+).
 *  3. Si la chaîne est is_premium_only et que l'utilisateur n'est pas premium
 *     → retourner la chaîne SANS l'URL de stream (champ stream_url = null).
 *  4. L'URL de stream n'est retournée que si l'utilisateur a le droit.
 */
app.get('/api/channels', requireAuth, detectClientType, async (req, res) => {
  try {
    // Construire la requête SQL dynamiquement
    let sql = `
      SELECT
        id,
        name,
        category,
        thumbnail_url,
        is_premium_only,
        is_safe_for_store,
        stream_url,
        sort_order
      FROM channels
      WHERE is_active = 1
    `;
    const params = [];

    // ── Filtre Store Version ──────────────────────────────────
    if (req.isStoreVersion) {
      sql += ' AND is_safe_for_store = 1';
    }

    sql += ' ORDER BY sort_order ASC, id ASC';

    const [channels] = await pool.execute(sql, params);

    // ── Contrôle Premium ──────────────────────────────────────
    const isPremium = req.user.is_premium;

    const sanitized = channels.map((ch) => {
      // Copie sans mutation directe
      const item = {
        id:                ch.id,
        name:              ch.name,
        category:          ch.category,
        thumbnail_url:     ch.thumbnail_url,
        is_premium_only:   !!ch.is_premium_only,
        is_safe_for_store: !!ch.is_safe_for_store,
        sort_order:        ch.sort_order,
        // L'URL n'est fournie que si l'utilisateur a le droit
        stream_url:
          ch.is_premium_only && !isPremium
            ? null   // ← accès refusé : le client affichera le BottomSheet VIP
            : ch.stream_url,
      };
      return item;
    });

    return res.json({ channels: sanitized, is_store_version: req.isStoreVersion });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/channels/:id — Détail d'une chaîne (même logique)
 */
app.get('/api/channels/:id', requireAuth, detectClientType, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (isNaN(channelId)) return res.status(400).json({ error: 'ID invalide.' });

  try {
    let sql = `
      SELECT id, name, category, thumbnail_url,
             is_premium_only, is_safe_for_store, stream_url, sort_order
      FROM channels
      WHERE id = ? AND is_active = 1
    `;
    const params = [channelId];

    if (req.isStoreVersion) {
      sql += ' AND is_safe_for_store = 1';
    }

    const [rows] = await pool.execute(sql, params);
    if (!rows.length) return res.status(404).json({ error: 'Chaîne introuvable.' });

    const ch = rows[0];
    const isPremium = req.user.is_premium;

    return res.json({
      id:                ch.id,
      name:              ch.name,
      category:          ch.category,
      thumbnail_url:     ch.thumbnail_url,
      is_premium_only:   !!ch.is_premium_only,
      is_safe_for_store: !!ch.is_safe_for_store,
      stream_url:
        ch.is_premium_only && !isPremium ? null : ch.stream_url,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * PATCH /api/user/premium — Activer le premium (appelé après paiement externe)
 * Sécurisé par un secret partagé entre le webhook et l'API.
 */
app.patch('/api/user/premium', async (req, res) => {
  const webhookSecret = req.headers['x-webhook-secret'];
  if (webhookSecret !== process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Accès refusé.' });
  }
  const { user_id, payment_ref, plan } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id requis.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE users SET is_premium = 1 WHERE id = ?', [user_id]);
    await conn.execute(
      'INSERT INTO subscriptions (user_id, plan, payment_ref) VALUES (?, ?, ?)',
      [user_id, plan || 'monthly', payment_ref || null]
    );
    await conn.commit();
    return res.json({ message: 'Premium activé.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    conn.release();
  }
});

// ── Démarrage ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n🚀 VagueTV API → http://localhost:${PORT}`);
  console.log(`📱 Émulateur Android → http://10.0.2.2:${PORT}`);
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connecté (XAMPP)');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL erreur :', err.message);
  }
});

export default app;
