import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_SETTINGS = {
  brand_name: "VYRAZ",
  hero_title: "Цифровые продукты,",
  hero_highlight: "которые работают.",
  hero_description: "Создаю сайты, Telegram-ботов и Mini Apps для бизнеса — от первой идеи до запуска и дальнейшего развития.",
  contact_email: "",
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    project TEXT NOT NULL,
    budget TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    accent TEXT NOT NULL DEFAULT 'paper' CHECK (accent IN ('paper', 'blue', 'red', 'acid')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS leads_status_created_idx ON leads(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS reviews_status_created_idx ON reviews(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS works_published_sort_idx ON works(published, sort_order, id DESC);
`;

export function createDatabase(filePath) {
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const db = new Database(absolutePath);
  try { chmodSync(absolutePath, 0o600); } catch {}
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);

  const seedSetting = db.prepare("INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)");
  const seed = db.transaction(() => {
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) seedSetting.run(key, value, now);
  });
  seed();

  const statements = {
    publicWorks: db.prepare("SELECT id, title, category, description, url, accent FROM works WHERE published = 1 ORDER BY sort_order ASC, id DESC"),
    publicReviews: db.prepare("SELECT id, name, rating, text, created_at FROM reviews WHERE status = 'approved' ORDER BY id DESC LIMIT 30"),
    settings: db.prepare("SELECT key, value FROM site_settings"),
    leads: db.prepare("SELECT * FROM leads ORDER BY id DESC"),
    works: db.prepare("SELECT * FROM works ORDER BY sort_order ASC, id DESC"),
    reviews: db.prepare("SELECT * FROM reviews ORDER BY id DESC"),
    insertLead: db.prepare("INSERT INTO leads (name, email, company, project, budget, message, status, created_at) VALUES (@name, @email, @company, @project, @budget, @message, 'new', @created_at)"),
    insertPublicReview: db.prepare("INSERT INTO reviews (name, email, rating, text, status, created_at, updated_at) VALUES (@name, @email, @rating, @text, 'pending', @created_at, @updated_at)"),
    updateLead: db.prepare("UPDATE leads SET status = ? WHERE id = ?"),
    insertWork: db.prepare("INSERT INTO works (title, category, description, url, accent, sort_order, published, created_at, updated_at) VALUES (@title, @category, @description, @url, @accent, @sort_order, @published, @created_at, @updated_at)"),
    updateWork: db.prepare("UPDATE works SET title = @title, category = @category, description = @description, url = @url, accent = @accent, sort_order = @sort_order, published = @published, updated_at = @updated_at WHERE id = @id"),
    insertReview: db.prepare("INSERT INTO reviews (name, email, rating, text, status, created_at, updated_at) VALUES (@name, @email, @rating, @text, @status, @created_at, @updated_at)"),
    updateReview: db.prepare("UPDATE reviews SET name = @name, email = @email, rating = @rating, text = @text, status = @status, updated_at = @updated_at WHERE id = @id"),
    upsertSetting: db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"),
  };

  const saveSettingsTransaction = db.transaction((settings) => {
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(settings)) statements.upsertSetting.run(key, value, now);
  });

  function settingsObject() {
    return Object.fromEntries(statements.settings.all().map((row) => [row.key, row.value]));
  }

  return {
    filePath: absolutePath,
    publicContent() {
      return { settings: settingsObject(), works: statements.publicWorks.all(), reviews: statements.publicReviews.all() };
    },
    adminData() {
      return { leads: statements.leads.all(), works: statements.works.all(), reviews: statements.reviews.all(), settings: settingsObject() };
    },
    insertLead(record) {
      return Number(statements.insertLead.run({ ...record, created_at: new Date().toISOString() }).lastInsertRowid);
    },
    insertPublicReview(record) {
      const now = new Date().toISOString();
      return Number(statements.insertPublicReview.run({ ...record, created_at: now, updated_at: now }).lastInsertRowid);
    },
    updateLead(id, status) {
      return statements.updateLead.run(status, id).changes > 0;
    },
    saveWork(record, id = null) {
      const now = new Date().toISOString();
      if (id) return statements.updateWork.run({ ...record, id, updated_at: now }).changes ? id : null;
      return Number(statements.insertWork.run({ ...record, created_at: now, updated_at: now }).lastInsertRowid);
    },
    saveReview(record, id = null) {
      const now = new Date().toISOString();
      if (id) return statements.updateReview.run({ ...record, id, updated_at: now }).changes ? id : null;
      return Number(statements.insertReview.run({ ...record, created_at: now, updated_at: now }).lastInsertRowid);
    },
    saveSettings(settings) {
      saveSettingsTransaction(settings);
    },
    delete(collection, id) {
      const tables = { leads: "leads", works: "works", reviews: "reviews" };
      const table = tables[collection];
      if (!table) return false;
      return db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
    },
    close() { db.close(); },
  };
}
