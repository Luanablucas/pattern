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

CREATE TABLE IF NOT EXISTS routines (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  period VARCHAR(10) NOT NULL DEFAULT 'flexible' CHECK (period IN ('morning','evening','flexible')),
  description VARCHAR(240) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);

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

ALTER TABLE events ADD COLUMN IF NOT EXISTS time_mode VARCHAR(12) NOT NULL DEFAULT 'exact';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='events_time_mode_check' AND conrelid='events'::regclass) THEN
    ALTER TABLE events ADD CONSTRAINT events_time_mode_check CHECK (time_mode IN ('exact','all_day','morning','afternoon','night'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS focus_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  task_title VARCHAR(160),
  mode VARCHAR(10) NOT NULL CHECK (mode IN ('pomodoro','free')),
  planned_seconds INTEGER CHECK (planned_seconds BETWEEN 300 AND 10800),
  status VARCHAR(10) NOT NULL CHECK (status IN ('running','paused','completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_since TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  pause_seconds INTEGER NOT NULL DEFAULT 0 CHECK (pause_seconds >= 0),
  finished_at TIMESTAMPTZ,
  CHECK ((mode='pomodoro' AND planned_seconds IS NOT NULL) OR (mode='free' AND planned_seconds IS NULL)),
  CHECK ((status='running' AND active_since IS NOT NULL AND paused_at IS NULL AND finished_at IS NULL)
    OR (status='paused' AND paused_at IS NOT NULL AND active_since IS NULL AND finished_at IS NULL)
    OR (status='completed' AND active_since IS NULL AND paused_at IS NULL AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_user_active ON focus_sessions(user_id)
  WHERE status IN ('running','paused');
CREATE INDEX IF NOT EXISTS idx_focus_user_finished ON focus_sessions(user_id,finished_at DESC)
  WHERE status='completed';

CREATE TABLE IF NOT EXISTS event_overrides (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  title VARCHAR(160) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  category_id UUID NOT NULL REFERENCES event_categories(id) ON DELETE RESTRICT,
  time_mode VARCHAR(12) NOT NULL CHECK (time_mode IN ('exact','all_day','morning','afternoon','night')),
  PRIMARY KEY (event_id, occurrence_date),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_event_overrides_window ON event_overrides(starts_at, ends_at);


CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(140) NOT NULL,
  description VARCHAR(1200) NOT NULL DEFAULT '',
  category VARCHAR(40) NOT NULL DEFAULT 'Pessoal',
  priority VARCHAR(6) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  due_date DATE,
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_goals_user_status ON goals(user_id,status);

CREATE TABLE IF NOT EXISTS goal_steps (
  id UUID PRIMARY KEY,
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goal_steps_goal ON goal_steps(goal_id,position);

CREATE TABLE IF NOT EXISTS goal_task_links (
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY(goal_id,task_id)
);
CREATE TABLE IF NOT EXISTS goal_habit_links (
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  habit_id UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  PRIMARY KEY(goal_id,habit_id)
);

CREATE TABLE IF NOT EXISTS goal_step_events (
  id UUID PRIMARY KEY,
  step_id UUID NOT NULL REFERENCES goal_steps(id) ON DELETE CASCADE,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goal_step_events_happened ON goal_step_events(happened_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_step_events_unique ON goal_step_events(step_id,happened_at);

CREATE TABLE IF NOT EXISTS planning_suggestions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_date DATE,
  goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  minutes SMALLINT NOT NULL CHECK (minutes BETWEEN 25 AND 120),
  reason TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','dismissed')),
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS idx_planning_user_status ON planning_suggestions(user_id,status,starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_active_task_date ON planning_suggestions(user_id,task_id,COALESCE(occurrence_date,DATE '0001-01-01')) WHERE status IN ('proposed','accepted');

ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(8) NOT NULL DEFAULT 'system';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_theme_preference_check' AND conrelid='users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_theme_preference_check CHECK (theme_preference IN ('light','dark','system'));
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email VARCHAR(254);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent VARCHAR(200) NOT NULL DEFAULT '',
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(user_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('verify_email','reset_password','change_email')),
  email_value VARCHAR(254),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id,purpose,expires_at) WHERE used_at IS NULL;
