CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  due_date DATE,
  priority VARCHAR(6) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((completed = TRUE AND completed_at IS NOT NULL) OR (completed = FALSE AND completed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_user_completed ON tasks(user_id, completed);

CREATE TABLE IF NOT EXISTS habits (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);

-- v0.4: rotinas agrupam hábitos; a exclusão de uma rotina não apaga os hábitos.
CREATE TABLE IF NOT EXISTS routines (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  period VARCHAR(10) NOT NULL DEFAULT 'flexible' CHECK (period IN ('morning','evening','flexible')),
  description VARCHAR(240) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);

-- Migração incremental: os hábitos existentes continuam diários e sem rotina.
ALTER TABLE habits ADD COLUMN IF NOT EXISTS schedule_days SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::SMALLINT[];
ALTER TABLE habits ADD COLUMN IF NOT EXISTS preferred_time TIME;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS goal_per_week SMALLINT NOT NULL DEFAULT 7;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS routine_id UUID REFERENCES routines(id) ON DELETE SET NULL;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'habits_schedule_days_check' AND conrelid='habits'::regclass) THEN
    ALTER TABLE habits ADD CONSTRAINT habits_schedule_days_check CHECK (
      cardinality(schedule_days) BETWEEN 1 AND 7 AND
      schedule_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'habits_goal_week_check' AND conrelid='habits'::regclass) THEN
    ALTER TABLE habits ADD CONSTRAINT habits_goal_week_check CHECK (goal_per_week BETWEEN 1 AND 7 AND goal_per_week <= cardinality(schedule_days));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_habits_user_routine ON habits(user_id, routine_id);

CREATE TABLE IF NOT EXISTS habit_entries (
  habit_id UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(habit_id, entry_date)
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_events_user_start ON events(user_id, starts_at);

ALTER TABLE events ADD COLUMN IF NOT EXISTS category VARCHAR(16) NOT NULL DEFAULT 'personal';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_category_check' AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events ADD CONSTRAINT events_category_check
      CHECK (category IN ('study','work','personal','health','other'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_events_user_end ON events(user_id, ends_at);

-- Pattern v0.5 — recorrências independentes de hábitos e categorias editáveis.
CREATE TABLE IF NOT EXISTS event_categories (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(40) NOT NULL,
  color VARCHAR(7) NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  legacy_key VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, legacy_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_categories_unique_name ON event_categories(user_id,lower(name));
INSERT INTO event_categories(id,user_id,name,color,legacy_key)
SELECT gen_random_uuid(),u.id,defaults.name,defaults.color,defaults.legacy_key
FROM users u CROSS JOIN (VALUES
 ('study','Estudos','#8e77d2'),('work','Trabalho','#73a1cf'),
 ('personal','Pessoal','#d68bab'),('health','Saúde','#75aa96'),
 ('other','Outros','#d5a26b')
) AS defaults(legacy_key,name,color)
ON CONFLICT DO NOTHING;

ALTER TABLE events ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES event_categories(id) ON DELETE RESTRICT;
UPDATE events AS e SET category_id=c.id
FROM event_categories AS c
WHERE e.category_id IS NULL AND c.user_id=e.user_id AND c.legacy_key=e.category;
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_type VARCHAR(8) NOT NULL DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_days SMALLINT[] NOT NULL DEFAULT '{}'::SMALLINT[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_until DATE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_type VARCHAR(8) NOT NULL DEFAULT 'none';
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_days SMALLINT[] NOT NULL DEFAULT '{}'::SMALLINT[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_until DATE;

CREATE TABLE IF NOT EXISTS task_occurrences (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(task_id, occurrence_date)
);
CREATE INDEX IF NOT EXISTS idx_task_occurrences_date ON task_occurrences(occurrence_date);
CREATE TABLE IF NOT EXISTS event_cancellations (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  PRIMARY KEY(event_id, occurrence_date)
);
