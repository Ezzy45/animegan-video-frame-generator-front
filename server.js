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

const JWT_SECRET         = process.env.JWT_SECRET        || 'CHANGE_ME_IN_PROD';
const JWT_EXPIRES_IN     = process.env.JWT_EXPIRES_IN    || '7d';
const APP_GLOBAL_PASSWORD = process.env.APP_GLOBAL_PASSWORD || '1234'; // Le mot de passe requis pour entrer dans l'app

const STORE_HEADER       = 'x-client-type'; 

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
 * Fonctionne indifféremment pour un compte anonyme ou un compte lié
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

function detectClientType(req, _res, next) {
  req.isStoreVersion = req.headers[STORE_HEADER] === 'store';
  next();
}

app.get('/', (_req, res) => res.json({ status: 'VagueTV API ✅' }));


// ── 🆕 Nouvelles Routes d'Authentification ───────────────────

/**
 * POST /api/auth/unlock
 * Déverrouille l'application via le mot de passe global.
 * Crée un utilisateur anonyme en base de données pour stocker ses futurs favoris.
 */
app.post(
  '/api/auth/unlock',
  [body('password').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { password } = req.body;

    // Vérification du mot de passe global de l'application
    if (password !== APP_GLOBAL_PASSWORD) {
      return res.status(401).json({ error: 'Mot de passe d’accès incorrect.' });
    }

    try {
      // On génère un utilisateur anonyme unique en BDD
      // (Idéalement, ton champ 'email' et 'password' dans la table 'users' doivent maintenant accepter la valeur NULL)
      const [result] = await pool.execute(
        'INSERT INTO users (email, password, is_premium) VALUES (NULL, NULL, 0)'
      );
      
      const userId = result.insertId;

      // On signe un jeton pour cet utilisateur anonyme (email = "")
      const token = jwt.sign(
        { id: userId, email: "", is_premium: false },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      return res.json({ 
        token, 
        is_premium: false,
        message: "Accès déverrouillé, session anonyme créée." 
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erreur serveur lors de la création de la session.' });
    }
  }
);

/**
 * POST /api/auth/link-account
 * Optionnel : Permet de lier un e-mail et un mot de passe à la session anonyme actuelle
 * pour ne pas perdre ses données.
 */
app.post(
  '/api/auth/link-account',
  requireAuth, // L'utilisateur doit posséder le jeton de sa session anonyme
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const userId = req.user.id;

    try {
      const hash = await bcrypt.hash(password, 12);
      
      // On met à jour l'utilisateur anonyme existant pour lui attribuer ses identifiants uniques
      await pool.execute(
        'UPDATE users SET email = ?, password = ? WHERE id = ?',
        [email, hash, userId]
      );

      // On regénère un token propre contenant le nouvel e-mail mis à jour
      const token = jwt.sign(
        { id: userId, email: email, is_premium: !!req.user.is_premium },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      return res.json({ token, message: 'Compte sauvegardé et lié avec succès !' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Cet e-mail est déjà associé à un autre compte.' });
      }
      console.error(err);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

/**
 * POST /api/auth/login-linked
 * Permet de se reconnecter à un compte précédemment sauvegardé (ex: sur un nouvel appareil)
 */
app.post(
  '/api/auth/login-linked',
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
      if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Identifiants incorrects ou compte inexistant.' });
      }

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


// ── API Admin ────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
 
app.get('/admin/api/channels', requireAdmin, async (req, res) => {
  try {
    const [channels] = await pool.execute('SELECT * FROM channels ORDER BY sort_order ASC, id ASC');
    return res.json({ channels });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});
 
app.post('/admin/api/channels', requireAdmin, async (req, res) => {
  const { name, category, stream_url, thumbnail_url, is_premium_only, is_safe_for_store, is_active, sort_order } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name et category sont obligatoires.' });
 
  try {
    const [result] = await pool.execute(
      `INSERT INTO channels (name, category, stream_url, thumbnail_url, is_premium_only, is_safe_for_store, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, category, stream_url || null, thumbnail_url || null, is_premium_only ? 1 : 0, is_safe_for_store !== false ? 1 : 0, is_active !== false ? 1 : 0, sort_order || 0]
    );
    return res.status(201).json({ message: 'Chaîne créée.', id: result.insertId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});
 
app.put('/admin/api/channels/:id', requireAdmin, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (isNaN(channelId)) return res.status(400).json({ error: 'ID invalide.' });
  const { name, category, stream_url, thumbnail_url, is_premium_only, is_safe_for_store, is_active, sort_order } = req.body;
 
  try {
    await pool.execute(
      `UPDATE channels SET name=?, category=?, stream_url=?, thumbnail_url=?, is_premium_only=?, is_safe_for_store=?, is_active=?, sort_order=? WHERE id=?`,
      [name, category, stream_url || null, thumbnail_url || null, is_premium_only ? 1 : 0, is_safe_for_store !== false ? 1 : 0, is_active !== false ? 1 : 0, sort_order || 0, channelId]
    );
    return res.json({ message: 'Chaîne modifiée.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});
 
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
 
app.post('/admin/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  const adminToken = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '8h' });
  return res.json({ token: adminToken });
});

// ── Routes Fonctionnelles (Chaînes) ─────────────────────────

app.get('/api/channels', requireAuth, detectClientType, async (req, res) => {
  try {
    let sql = `SELECT id, name, category, thumbnail_url, is_premium_only, is_safe_for_store, stream_url, sort_order FROM channels WHERE is_active = 1`;
    if (req.isStoreVersion) sql += ' AND is_safe_for_store = 1';
    sql += ' ORDER BY sort_order ASC, id ASC';

    const [channels] = await pool.execute(sql);
    const isPremium = req.user.is_premium;

    const sanitized = channels.map((ch) => ({
      id:                ch.id,
      name:              ch.name,
      category:          ch.category,
      thumbnail_url:     ch.thumbnail_url,
      is_premium_only:   !!ch.is_premium_only,
      is_safe_for_store: !!ch.is_safe_for_store,
      sort_order:        ch.sort_order,
      stream_url:        ch.is_premium_only && !isPremium ? null : ch.stream_url,
    }));

    return res.json({ channels: sanitized, is_store_version: req.isStoreVersion });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.get('/api/channels/:id', requireAuth, detectClientType, async (req, res) => {
  const channelId = parseInt(req.params.id, 10);
  if (isNaN(channelId)) return res.status(400).json({ error: 'ID invalide.' });

  try {
    let sql = `SELECT id, name, category, thumbnail_url, is_premium_only, is_safe_for_store, stream_url, sort_order FROM channels WHERE id = ? AND is_active = 1`;
    if (req.isStoreVersion) sql += ' AND is_safe_for_store = 1';

    const [rows] = await pool.execute(sql, [channelId]);
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
      stream_url:        ch.is_premium_only && !isPremium ? null : ch.stream_url,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.patch('/api/user/premium', async (req, res) => {
  const webhookSecret = req.headers['x-webhook-secret'];
  if (webhookSecret !== process.env.WEBHOOK_SECRET) return res.status(403).json({ error: 'Accès refusé.' });
  
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
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connecté (XAMPP)');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL erreur :', err.message);
  }
});

export default app;
