-- סכמת מסד הנתונים של מערכת הזמנת אולפנים (Cloudflare D1 / SQLite)
-- אין מפתחות זרים בכוונה: כך מחיקת משתמש לא נתקעת, והאכיפה נעשית בקוד השרת.

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,            -- מזהה פנימי אקראי (לא ה-ID של Google)
  sub          TEXT NOT NULL UNIQUE,        -- מזהה החשבון של Google
  email        TEXT NOT NULL UNIQUE,        -- תמיד באותיות קטנות, @edu.jmc.ac.il
  name         TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT '',    -- סטודנט / מרצה ...
  photo        TEXT NOT NULL DEFAULT '',    -- תמונה קטנה כ-data URL
  profile_done INTEGER NOT NULL DEFAULT 0,  -- 1 אחרי שהמשתמש מילא את טופס ההרשמה
  status       TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected / removed
  decided_by   TEXT,
  decided_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_login   INTEGER
);

-- מזהה ההתחברות נשמר רק כגיבוב (hash): גם מי שקורא את המסד לא יכול להתחזות
CREATE TABLE IF NOT EXISTS sessions (
  hash       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_exp  ON sessions(expires_at);

-- שורה אחת לכל עמדה ולכל שעה. UNIQUE מונע הזמנה כפולה ברמת מסד הנתונים עצמו.
CREATE TABLE IF NOT EXISTS bookings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  studio          TEXT NOT NULL,
  date            TEXT NOT NULL,            -- YYYY-MM-DD
  hour            INTEGER NOT NULL,
  gid             TEXT NOT NULL,            -- מזהה קבוצה: הזמנה אחת יכולה לכלול כמה עמדות ושעות
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT '',
  purpose         TEXT NOT NULL,
  people          INTEGER NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  transferred_from TEXT,
  transferred_at  INTEGER,
  UNIQUE (studio, date, hour),
  CHECK (hour BETWEEN 0 AND 23)
);
CREATE INDEX IF NOT EXISTS bookings_gid  ON bookings(gid);
CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id, date);
CREATE INDEX IF NOT EXISTS bookings_date ON bookings(date);

CREATE TABLE IF NOT EXISTS transfers (
  gid         TEXT PRIMARY KEY,
  from_uid    TEXT NOT NULL,
  from_name   TEXT NOT NULL,
  to_email    TEXT NOT NULL,
  status      TEXT NOT NULL,                -- pending / accepted / declined / void
  date        TEXT NOT NULL,
  from_hour   INTEGER NOT NULL,
  to_hour     INTEGER NOT NULL,
  studios     TEXT NOT NULL,                -- JSON
  created_at  INTEGER NOT NULL,
  answered_at INTEGER
);
CREATE INDEX IF NOT EXISTS transfers_to   ON transfers(to_email);
CREATE INDEX IF NOT EXISTS transfers_from ON transfers(from_uid);

CREATE TABLE IF NOT EXISTS noshows (
  gid        TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  date       TEXT NOT NULL,
  studios    TEXT NOT NULL,                 -- JSON
  from_hour  INTEGER NOT NULL,
  to_hour    INTEGER NOT NULL,
  end_at     INTEGER NOT NULL,              -- זמן סיום ההזמנה (מילישניות)
  marked_by  TEXT NOT NULL DEFAULT '',
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS noshows_user ON noshows(user_id);

CREATE TABLE IF NOT EXISTS releases (
  user_id TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,
  by_name TEXT NOT NULL DEFAULT ''
);

-- יומן פעולות רגישות (כניסות, אישורים, מחיקות, סימוני אי-הגעה)
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);

-- הגבלת קצב (מניעת ניסיונות רבים מדי)
CREATE TABLE IF NOT EXISTS rl (
  k TEXT PRIMARY KEY,
  w INTEGER NOT NULL,
  n INTEGER NOT NULL
);

-- מונה גרסה: עולה בכל שינוי, כדי שהדפדפן ישאל "השתנה משהו?" בשאילתה זולה
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (k, v) VALUES ('ver', 1);
