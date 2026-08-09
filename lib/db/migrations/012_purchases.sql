-- Migration 012: purchases — payment audit trail + webhook idempotency
-- provider_session_id is UNIQUE so duplicate webhook deliveries are no-ops.

CREATE TABLE IF NOT EXISTS purchases (
  id                    serial PRIMARY KEY,
  provider              varchar(32)  NOT NULL DEFAULT 'stripe',
  provider_session_id   varchar(256) NOT NULL UNIQUE,
  provider_customer_id  varchar(256),
  email                 varchar(256) NOT NULL,
  full_name             varchar(256),
  amount_total          integer,           -- in provider's smallest currency unit (cents)
  currency              varchar(8),
  status                varchar(32)  NOT NULL DEFAULT 'pending',
  tool_access_days      integer      NOT NULL DEFAULT 30,
  user_id               integer REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamp    NOT NULL DEFAULT now(),
  updated_at            timestamp    NOT NULL DEFAULT now()
);
