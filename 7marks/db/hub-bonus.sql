-- =====================================================================
-- ACCOUNT HUB — additive migration for the daily credit bonus.
--
-- ⚠ THIS RUNS AGAINST THE SHARED HUB DATABASE, NOT THE 7MARKS ONE.
--    The hub is shared with 7Solve. This migration is additive only: it
--    creates one new table and alters nothing that exists, so no query
--    7Solve makes today can behave differently afterwards.
--
-- Why the ledger lives here and not in 7Marks
--   The hub owns the wallet. If 7Marks recorded the claim and the hub
--   moved the credits, the two could disagree — a granted bonus with no
--   record, or a record with no credits. Writing the ledger row and the
--   wallet update in ONE hub transaction is the only arrangement where
--   that cannot happen.
--
-- Idempotency
--   UNIQUE (user_id, tool, bonus_key, grant_date) is the whole mechanism.
--   The grant is attempted as an INSERT first: if it collides, the bonus
--   was already claimed today and the wallet is never touched. That holds
--   under double-taps, retries and two devices claiming at once, because
--   the database — not the application — decides who wins.
--
--   grant_date is a DATE in UTC, taken from the SERVER. A client clock is
--   never consulted, so changing a device's date grants nothing.
-- =====================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS credit_bonus_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  tool        VARCHAR(24)  NOT NULL,          -- '7marks', matching tool_credits.tool
  bonus_key   VARCHAR(32)  NOT NULL,          -- 'daily20' — room for future grants
  grant_date  DATE         NOT NULL,          -- server UTC date
  credits     SMALLINT UNSIGNED NOT NULL,
  plan_at_grant VARCHAR(24) NOT NULL DEFAULT '',  -- audit: which plan earned it
  created_at  DATETIME     NOT NULL,
  UNIQUE KEY uq_bonus_day (user_id, tool, bonus_key, grant_date),
  KEY ix_bonus_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- The API side (for reference — implemented in account-hub/api.php as a
-- new `case 'bonus':`, adding no behaviour to any existing action):
--
--   BEGIN;
--     INSERT INTO credit_bonus_log
--       (user_id, tool, bonus_key, grant_date, credits, plan_at_grant, created_at)
--     VALUES (?, ?, ?, UTC_DATE(), ?, ?, UTC_TIMESTAMP());
--     -- a duplicate key here means already claimed: ROLLBACK and report
--     -- already_claimed WITHOUT touching the wallet.
--     UPDATE tool_credits SET credits = credits + ?
--       WHERE user_id = ? AND tool = ?;
--   COMMIT;
--
-- Entitlement is checked before any of this: only a plan that actually
-- carries a daily allowance may claim, and the amount comes from the plan
-- definition on the server, never from the request body.
-- ---------------------------------------------------------------------
