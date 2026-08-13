-- =====================================================================
-- 7MARKS — Phase B0 schema.
--
-- This database owns everything ACADEMIC. It never stores identity,
-- credentials, credits, plans or payments: the account hub remains the sole
-- authority for those, and the only thing that crosses the boundary is
-- hub_user_id. Nothing here is readable or writable by 7Solve.
--
-- Run against the 7Marks database ONLY. It must not be the hub's database.
--
-- Conventions
--   hub_user_id   INT UNSIGNED, the hub's users.id. Not a foreign key —
--                 it points into a different database, so integrity is
--                 enforced in the API layer, not by the engine.
--   *_json        JSON columns hold shapes the UI already uses, so the
--                 localStorage driver can be swapped without reshaping data.
--   utf8mb4       throughout: question text carries Devanagari, Telugu,
--                 Tamil and emoji, and utf8 (3-byte) silently truncates them.
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------
-- users_mirror — A CACHE, NEVER AN AUTHORITY.
-- Exists so a leaderboard or friends list can render a name without an
-- N+1 call back to the hub. Every row is disposable: truncating this table
-- must never lose anything that cannot be refetched. Nothing may read a
-- credit balance, plan or entitlement from here.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users_mirror (
  hub_user_id      INT UNSIGNED NOT NULL PRIMARY KEY,
  display_name     VARCHAR(60)  NOT NULL DEFAULT '',
  avatar_seed      VARCHAR(16)  NOT NULL DEFAULT '',

  -- Two SEPARATE privacy questions, because they are genuinely different:
  -- appearing on a leaderboard is not the same as letting someone open
  -- your individual test results.
  privacy_profile  ENUM('nobody','friends','everyone') NOT NULL DEFAULT 'friends',
  privacy_results  ENUM('nobody','friends','everyone') NOT NULL DEFAULT 'nobody',

  refreshed_at     DATETIME     NOT NULL,
  created_at       DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Subjects and topics the student typed themselves.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id  INT UNSIGNED NOT NULL,
  name         VARCHAR(120) NOT NULL,
  created_at   DATETIME     NOT NULL,
  UNIQUE KEY uq_subject (hub_user_id, name),
  KEY ix_subject_user (hub_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS topics (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id  INT UNSIGNED NOT NULL,
  subject      VARCHAR(120) NOT NULL,
  name         VARCHAR(160) NOT NULL,
  created_at   DATETIME     NOT NULL,
  UNIQUE KEY uq_topic (hub_user_id, subject, name),
  KEY ix_topic_user (hub_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- question_sets — a generated QuestionSet, reusable across attempts.
-- questions_json holds the validated question shape the engine already
-- consumes, including the answer key. It is NEVER sent to the browser
-- during a live attempt; the API strips answers on the way out.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_sets (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id    INT UNSIGNED NOT NULL,
  subject        VARCHAR(120) NOT NULL,
  topic          VARCHAR(160) NOT NULL DEFAULT '',
  difficulty     ENUM('Easy','Medium','Hard','Mixed') NOT NULL DEFAULT 'Medium',
  language       VARCHAR(32)  NOT NULL DEFAULT 'English',
  kind           ENUM('test','study','paper','retry','mistake','quick') NOT NULL DEFAULT 'test',
  source         ENUM('topic','text','image','paper','pdf') NOT NULL DEFAULT 'topic',
  questions_json JSON         NOT NULL,
  question_count SMALLINT UNSIGNED NOT NULL,
  marks          SMALLINT UNSIGNED NOT NULL,
  minutes        SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  untimed        TINYINT(1)   NOT NULL DEFAULT 0,
  credits_spent  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME     NOT NULL,
  KEY ix_set_user (hub_user_id, created_at),
  KEY ix_set_topic (hub_user_id, subject, topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- attempts — the authoritative sitting.
--
-- started_at and ends_at are set by the SERVER and never accepted from the
-- client. This table is what makes exam integrity possible: after B2 the
-- browser can no longer award itself time or a score.
--
-- client_nonce is UNIQUE per user so a double-tapped Start, a retried
-- request or a flaky connection produces ONE attempt with ONE clock
-- instead of two.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attempts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id   INT UNSIGNED NOT NULL,
  set_id        BIGINT UNSIGNED NOT NULL,
  client_nonce  CHAR(36)     NOT NULL,
  status        ENUM('live','locked','submitted','abandoned') NOT NULL DEFAULT 'live',
  untimed       TINYINT(1)   NOT NULL DEFAULT 0,
  started_at    DATETIME     NOT NULL,
  ends_at       DATETIME     NULL,          -- NULL when untimed
  submitted_at  DATETIME     NULL,
  auto_submitted TINYINT(1)  NOT NULL DEFAULT 0,
  answers_json  JSON         NULL,
  marked_json   JSON         NULL,
  revealed_json JSON         NULL,
  plan_id       BIGINT UNSIGNED NULL,       -- the planner session it fulfils
  updated_at    DATETIME     NOT NULL,
  UNIQUE KEY uq_attempt_nonce (hub_user_id, client_nonce),
  KEY ix_attempt_user (hub_user_id, started_at),
  KEY ix_attempt_live (status, ends_at),    -- the sweeper for expired attempts
  CONSTRAINT fk_attempt_set FOREIGN KEY (set_id) REFERENCES question_sets(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- results — graded server-side, written in the same transaction as the
-- attempt's submission. One result per attempt, enforced.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS results (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  attempt_id   BIGINT UNSIGNED NOT NULL,
  hub_user_id  INT UNSIGNED NOT NULL,
  subject      VARCHAR(120) NOT NULL,
  topic        VARCHAR(160) NOT NULL DEFAULT '',
  kind         ENUM('test','study','paper','retry','mistake','quick') NOT NULL DEFAULT 'test',
  difficulty   ENUM('Easy','Medium','Hard','Mixed') NOT NULL DEFAULT 'Medium',
  got          SMALLINT UNSIGNED NOT NULL,
  max_marks    SMALLINT UNSIGNED NOT NULL,
  pct          TINYINT UNSIGNED  NOT NULL,
  total_q      SMALLINT UNSIGNED NOT NULL,
  correct      SMALLINT UNSIGNED NOT NULL,
  wrong        SMALLINT UNSIGNED NOT NULL,
  skipped      SMALLINT UNSIGNED NOT NULL,
  revealed     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  accuracy     TINYINT UNSIGNED  NOT NULL,
  seconds      INT UNSIGNED      NOT NULL,
  review_json  JSON              NOT NULL,
  created_at   DATETIME          NOT NULL,
  UNIQUE KEY uq_result_attempt (attempt_id),
  KEY ix_result_user (hub_user_id, created_at),
  KEY ix_result_topic (hub_user_id, subject, topic),
  KEY ix_result_board (hub_user_id, created_at, pct),   -- leaderboard windows
  CONSTRAINT fk_result_attempt FOREIGN KEY (attempt_id) REFERENCES attempts(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- mistakes — one row per distinct question a student keeps getting wrong.
-- question_hash makes "wrong 3 times" possible without duplicating rows.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mistakes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id   INT UNSIGNED NOT NULL,
  question_hash CHAR(64)     NOT NULL,      -- sha256 of the normalised text
  subject       VARCHAR(120) NOT NULL,
  topic         VARCHAR(160) NOT NULL DEFAULT '',
  question      TEXT         NOT NULL,
  given_answer  TEXT         NULL,
  correct_answer TEXT        NULL,
  difficulty    ENUM('Easy','Medium','Hard','Mixed') NOT NULL DEFAULT 'Medium',
  wrong_count   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  first_at      DATETIME     NOT NULL,
  last_at       DATETIME     NOT NULL,
  UNIQUE KEY uq_mistake (hub_user_id, question_hash),
  KEY ix_mistake_user (hub_user_id, last_at),
  KEY ix_mistake_topic (hub_user_id, subject, topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- sessions — the study planner. status only ever reaches 'done' because an
-- activity was FINISHED; opening or starting one must not touch it.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id  INT UNSIGNED NOT NULL,
  subject      VARCHAR(120) NOT NULL,
  topic        VARCHAR(160) NOT NULL DEFAULT '',
  session_date DATE         NOT NULL,
  session_time TIME         NULL,
  duration_min SMALLINT UNSIGNED NOT NULL DEFAULT 45,
  priority     TINYINT UNSIGNED  NOT NULL DEFAULT 1,   -- 0 low, 1 normal, 2 high
  status       ENUM('planned','done','skipped') NOT NULL DEFAULT 'planned',
  score_pct    TINYINT UNSIGNED NULL,
  attempt_id   BIGINT UNSIGNED NULL,
  done_at      DATETIME     NULL,
  created_at   DATETIME     NOT NULL,
  KEY ix_session_user (hub_user_id, session_date),
  KEY ix_session_status (hub_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- achievements — the UNIQUE key is what stops a badge unlocking twice.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievements (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id  INT UNSIGNED NOT NULL,
  achieve_key  VARCHAR(48)  NOT NULL,
  earned_at    DATETIME     NOT NULL,
  UNIQUE KEY uq_achieve (hub_user_id, achieve_key),
  KEY ix_achieve_user (hub_user_id, earned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- events — the activity trail.
--
-- Deliberately NOT a source of truth: the tables above stay authoritative.
-- This exists so achievements, notifications, debugging and later analytics
-- have one honest chronological record to read, instead of each inferring
-- history from mutable rows.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id  INT UNSIGNED NOT NULL,
  event_type   VARCHAR(48)  NOT NULL,   -- attempt.started, result.created, ...
  entity_type  VARCHAR(32)  NOT NULL DEFAULT '',
  entity_id    BIGINT UNSIGNED NULL,
  payload_json JSON         NULL,
  created_at   DATETIME     NOT NULL,
  KEY ix_event_user (hub_user_id, created_at),
  KEY ix_event_type (event_type, created_at),
  KEY ix_event_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- PHASE B4/B5 — created now so the shape is agreed, populated later.
-- =====================================================================

-- One row per PAIR, stored with user_a < user_b, so a friendship cannot
-- exist twice with the two rows disagreeing about its status.
CREATE TABLE IF NOT EXISTS friends (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_a       INT UNSIGNED NOT NULL,
  user_b       INT UNSIGNED NOT NULL,
  requested_by INT UNSIGNED NOT NULL,
  status       ENUM('pending','accepted','blocked') NOT NULL DEFAULT 'pending',
  created_at   DATETIME     NOT NULL,
  updated_at   DATETIME     NOT NULL,
  UNIQUE KEY uq_pair (user_a, user_b),
  KEY ix_friend_a (user_a, status),
  KEY ix_friend_b (user_b, status),
  CONSTRAINT ck_pair_order CHECK (user_a < user_b)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS challenges (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  from_user    INT UNSIGNED NOT NULL,
  to_user      INT UNSIGNED NOT NULL,
  set_id       BIGINT UNSIGNED NOT NULL,
  minutes      SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  status       ENUM('sent','accepted','declined','expired','done') NOT NULL DEFAULT 'sent',
  expires_at   DATETIME     NOT NULL,
  created_at   DATETIME     NOT NULL,
  KEY ix_ch_to (to_user, status),
  KEY ix_ch_from (from_user, created_at),
  KEY ix_ch_expiry (status, expires_at),
  CONSTRAINT fk_ch_set FOREIGN KEY (set_id) REFERENCES question_sets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One run each: a challenger cannot improve their score by re-sitting.
CREATE TABLE IF NOT EXISTS challenge_runs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  challenge_id BIGINT UNSIGNED NOT NULL,
  hub_user_id  INT UNSIGNED NOT NULL,
  attempt_id   BIGINT UNSIGNED NOT NULL,
  pct          TINYINT UNSIGNED NOT NULL,
  seconds      INT UNSIGNED     NOT NULL,
  created_at   DATETIME         NOT NULL,
  UNIQUE KEY uq_run (challenge_id, hub_user_id),
  CONSTRAINT fk_run_ch FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drops (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  from_user    INT UNSIGNED NOT NULL,
  question_json JSON        NOT NULL,
  audience     ENUM('friends','room','everyone') NOT NULL DEFAULT 'friends',
  time_limit_s SMALLINT UNSIGNED NOT NULL DEFAULT 300,
  send_date    DATE         NOT NULL,      -- with from_user, enforces the daily cap
  expires_at   DATETIME     NOT NULL,
  created_at   DATETIME     NOT NULL,
  KEY ix_drop_from (from_user, send_date),
  KEY ix_drop_live (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drop_runs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  drop_id      BIGINT UNSIGNED NOT NULL,
  hub_user_id  INT UNSIGNED NOT NULL,
  started_at   DATETIME     NOT NULL,      -- set when they press Start, not on open
  answered_at  DATETIME     NULL,
  is_correct   TINYINT(1)   NULL,
  seconds      INT UNSIGNED NULL,
  UNIQUE KEY uq_drop_run (drop_id, hub_user_id),
  CONSTRAINT fk_droprun FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id  INT UNSIGNED NOT NULL,
  kind         VARCHAR(40)  NOT NULL,
  payload_json JSON         NULL,
  read_at      DATETIME     NULL,
  created_at   DATETIME     NOT NULL,
  KEY ix_notif_user (hub_user_id, created_at),
  KEY ix_notif_unread (hub_user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- leaderboard — MATERIALISED, recomputed on a schedule. Never queried live
-- across results, and never recomputed per page view, so a rank cannot
-- flicker between two refreshes.
--
-- score = accuracy*0.45 + difficulty*0.25 + volume*0.15 + improvement*0.15
-- with difficulty weighted Easy 0.80, Medium 1.00, Hard 1.25.
-- Eligibility (min attempts, min questions, submitted only) is applied by
-- the recompute job; ineligible users simply have no row.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leaderboard (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hub_user_id   INT UNSIGNED NOT NULL,
  window_key    ENUM('week','month','all') NOT NULL,
  subject       VARCHAR(120) NOT NULL DEFAULT '',   -- '' = across all subjects
  score         DECIMAL(8,3) NOT NULL,
  rank_now      INT UNSIGNED NOT NULL,
  rank_prev     INT UNSIGNED NULL,
  attempts      SMALLINT UNSIGNED NOT NULL,
  questions     SMALLINT UNSIGNED NOT NULL,
  accuracy      TINYINT UNSIGNED  NOT NULL,
  computed_at   DATETIME     NOT NULL,
  UNIQUE KEY uq_board (window_key, subject, hub_user_id),
  KEY ix_board_rank (window_key, subject, rank_now)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- schema_version — so a migration can never be applied twice.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_version (
  version      INT UNSIGNED NOT NULL PRIMARY KEY,
  applied_at   DATETIME     NOT NULL,
  note         VARCHAR(160) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_version (version, applied_at, note)
VALUES (1, UTC_TIMESTAMP(), 'Phase B0 — academic tables, events, social + leaderboard shells');
