-- Knowledge base, tag vectors, traces, outcomes and call logs in one Tiger Data (PostgreSQL) service.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS knowledge (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind        text NOT NULL CHECK (kind IN ('skill', 'prompt', 'graph')),
    title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    body        text NOT NULL,
    summary     text NOT NULL,
    use_count   integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_updated_idx ON knowledge (updated_at DESC);

CREATE TABLE IF NOT EXISTS tag (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL UNIQUE CHECK (name = lower(name) AND char_length(name) BETWEEN 1 AND 64),
    embedding   vector(768) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tag_embedding_idx ON tag USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS knowledge_tag (
    knowledge_id uuid NOT NULL REFERENCES knowledge (id) ON DELETE CASCADE,
    tag_id       uuid NOT NULL REFERENCES tag (id) ON DELETE CASCADE,
    PRIMARY KEY (knowledge_id, tag_id)
);
CREATE INDEX IF NOT EXISTS knowledge_tag_tag_idx ON knowledge_tag (tag_id);

-- Per-request pipeline trace (no prompt text): tags, candidate scores, step timings, derived features.
CREATE TABLE IF NOT EXISTS enhance_trace (
    created_at      timestamptz NOT NULL DEFAULT now(),
    request_id      text NOT NULL,
    prompt_revision integer NOT NULL,
    result_type     text NOT NULL,
    general         boolean NOT NULL,
    tags            jsonb NOT NULL DEFAULT '[]',
    knowledge       jsonb NOT NULL DEFAULT '[]',
    steps           jsonb NOT NULL DEFAULT '[]',
    features        jsonb NOT NULL DEFAULT '{}'
);
SELECT create_hypertable('enhance_trace', by_range('created_at'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS enhance_trace_request_idx ON enhance_trace (request_id, created_at DESC);

-- Outcomes keep derived features only; retained for classifier training.
CREATE TABLE IF NOT EXISTS outcome_event (
    time              timestamptz NOT NULL DEFAULT now(),
    request_id        text NOT NULL,
    prompt_revision   integer NOT NULL,
    event             text NOT NULL CHECK (event IN ('shown', 'accepted', 'declined', 'dismissed', 'superseded')),
    option_id         text,
    time_to_action_ms integer,
    features          jsonb NOT NULL DEFAULT '{}',
    exported_at       timestamptz
);
SELECT create_hypertable('outcome_event', by_range('time'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS outcome_event_request_idx ON outcome_event (request_id, time DESC);

CREATE TABLE IF NOT EXISTS api_call_log (
    time        timestamptz NOT NULL DEFAULT now(),
    request_id  text NOT NULL,
    method      text NOT NULL,
    path        text NOT NULL,
    status      integer NOT NULL,
    latency_ms  integer NOT NULL,
    error       text
);
SELECT create_hypertable('api_call_log', by_range('time'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS api_call_log_request_idx ON api_call_log (request_id, time DESC);

CREATE TABLE IF NOT EXISTS ai_call_log (
    time          timestamptz NOT NULL DEFAULT now(),
    request_id    text NOT NULL,
    operation     text NOT NULL,
    model         text NOT NULL,
    status        text NOT NULL CHECK (status IN ('ok', 'error')),
    latency_ms    integer NOT NULL,
    input_tokens  integer,
    output_tokens integer,
    error         text
);
SELECT create_hypertable('ai_call_log', by_range('time'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS ai_call_log_request_idx ON ai_call_log (request_id, time DESC);

-- D2: 30-day retention for logs and traces.
SELECT add_retention_policy('api_call_log', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('ai_call_log', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('enhance_trace', INTERVAL '30 days', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS app_settings (
    id                   smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    trigger_delay_ms     integer NOT NULL DEFAULT 400 CHECK (trigger_delay_ms BETWEEN 150 AND 1500),
    autocomplete_enabled boolean NOT NULL DEFAULT TRUE,
    questions_enabled    boolean NOT NULL DEFAULT TRUE,
    max_options          integer NOT NULL DEFAULT 4 CHECK (max_options BETWEEN 2 AND 6)
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS handoff (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics_state (
    id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_export_at     timestamptz,
    last_export_count  integer,
    classifier_auc     double precision,
    classifier_rows    integer,
    classifier_trained_at timestamptz
);
INSERT INTO analytics_state (id) VALUES (1) ON CONFLICT DO NOTHING;
