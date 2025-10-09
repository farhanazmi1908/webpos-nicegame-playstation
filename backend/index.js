/**
 * WebPOS Backend (Express + better-sqlite3)
 * - Auth (JWT) with default admin/123456 (change in production)
 * - Endpoints: /auth, /products, /sales, /expenses, /backup, /export
 * - DB file: ./data/webpos.sqlite
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const SECRET = process.env.JWT_SECRET || 'change_this_secret';
const PORT = process.env.PORT || 3001;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, 'webpos.sqlite');
const db = new Database(dbFile);

// init tables
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT,
  name TEXT,
  price INTEGER,
  cost INTEGER,
  stock INTEGER
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  subtotal INTEGER,
  total_cost INTEGER,
  discount INTEGER,
  extra_fee INTEGER,
  payment_amount INTEGER,
  items_json TEXT
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT,
  amount INTEGER,
  date TEXT
);
`);

// seed admin
const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!admin) {
  const hashed = bcrypt.hashSync('123456', 8);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hashed, 'admin');
  console.log('Default admin created: admin / 123456');
}

const app = express();
app.use(cors());
app.use(express.json());

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: '12h' });
}

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).send({ error: 'Unauthorized' });
  const token = h.split(' ')[1];
  try {
    const data = jwt.verify(token, SECRET);
    req.user = data;
    next();
  } catch (e) {
    return res.status(401).send({ error: 'Invalid token' });
  }
}

// auth
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).send({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).send({ error: 'Invalid credentials' });
  const token = signToken(user);
  res.send({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.post('/auth/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(oldPassword, user.password)) return res.status(400).send({ error: 'Invalid password' });
  const hashed = bcrypt.hashSync(newPassword, 8);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
  res.send({ ok: true });
});

// products
app.get('/products', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.send(rows);
});
app.post('/products', auth, (req, res) => {
  const { sku, name, price, cost, stock } = req.body;
  const info = db.prepare('INSERT INTO products (sku, name, price, cost, stock) VALUES (?, ?, ?, ?, ?)').run(sku||'', name, price||0, cost||0, stock||0);
  res.send({ id: info.lastInsertRowid });
});
app.put('/products/:id', auth, (req, res) => {
  const id = req.params.id;
  const { sku, name, price, cost, stock } = req.body;
  db.prepare('UPDATE products SET sku=?, name=?, price=?, cost=?, stock=? WHERE id=?').run(sku||'', name, price||0, cost||0, stock||0, id);
  res.send({ ok: true });
});
app.delete('/products/:id', auth, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.send({ ok: true });
});

// sales (checkout)
app.post('/sales', auth, (req, res) => {
  const body = req.body;
  const now = new Date().toISOString();
  const info = db.prepare('INSERT INTO sales (created_at, subtotal, total_cost, discount, extra_fee, payment_amount, items_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(now, body.subtotal||0, body.total_cost||0, body.discount||0, body.extra_fee||0, body.payment_amount||0, JSON.stringify(body.items||[]));
  // reduce stock
  const items = body.items || [];
  const getp = db.prepare('SELECT id, stock FROM products WHERE id = ?');
  const upd = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  for (const it of items) {
    const p = getp.get(it.productId);
    if (p) upd.run(it.qty, it.productId);
  }
  res.send({ id: info.lastInsertRowid });
});
app.get('/sales', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM sales ORDER BY id DESC').all();
  res.send(rows);
});

// expenses
app.get('/expenses', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM expenses ORDER BY id DESC').all();
  res.send(rows);
});
app.post('/expenses', auth, (req, res) => {
  const { label, amount } = req.body;
  const info = db.prepare('INSERT INTO expenses (label, amount, date) VALUES (?, ?, ?)').run(label, amount, new Date().toISOString());
  res.send({ id: info.lastInsertRowid });
});

// export CSV (products/sales)
app.get('/export/:table', auth, (req, res) => {
  const table = req.params.table;
  if (!['products','sales'].includes(table)) return res.status(400).send({ error: 'Invalid' });
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  if (!rows || rows.length===0) return res.status(404).send({ error: 'No data' });
  const header = Object.keys(rows[0]).join(',');
  const csv = rows.map(r => Object.values(r).join(',')).join('\n');
  const filePath = path.join(__dirname, 'backup', `${table}_${Date.now()}.csv`);
  if (!fs.existsSync(path.join(__dirname,'backup'))) fs.mkdirSync(path.join(__dirname,'backup'));
  fs.writeFileSync(filePath, header + '\n' + csv);
  res.download(filePath);
});

// backup DB file
app.get('/backup', auth, (req, res) => {
  if (!fs.existsSync(path.join(__dirname,'backup'))) fs.mkdirSync(path.join(__dirname,'backup'));
  const dest = path.join(__dirname,'backup', `webpos_backup_${Date.now()}.sqlite`);
  fs.copyFileSync(dbFile, dest);
  res.download(dest);
});

app.get('/', (req, res) => res.send({ ok: true, name: 'Nice Game Playstation WebPOS Backend' }));

app.listen(PORT, () => {
  console.log('Backend running on port', PORT);
});
