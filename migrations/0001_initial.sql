CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL,
  budget TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS leads_status_created_idx ON leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_status_created_idx ON reviews(status, created_at DESC);
CREATE INDEX IF NOT EXISTS works_published_sort_idx ON works(published, sort_order, id DESC);

INSERT OR IGNORE INTO site_settings (key, value) VALUES
  ('brand_name', 'VYRAZ'),
  ('hero_title', 'Цифровые продукты,'),
  ('hero_highlight', 'которые работают.'),
  ('hero_description', 'Создаю сайты, Telegram-ботов и Mini Apps для бизнеса — от первой идеи до запуска и дальнейшего развития.'),
  ('contact_email', '');
