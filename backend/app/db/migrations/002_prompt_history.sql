-- User-requested content storage, deliberately separate from payload-free telemetry.
-- Saved versions persist until explicitly deleted and are not exported to analytics.
CREATE TABLE IF NOT EXISTS prompt_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt text NOT NULL CHECK (char_length(prompt) > 0),
    suggestion_text text,
    title text CHECK (char_length(title) BETWEEN 1 AND 120),
    description text CHECK (char_length(description) <= 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prompt_history_created_idx ON prompt_history (created_at DESC, id DESC);
