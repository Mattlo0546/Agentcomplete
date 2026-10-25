-- Move the previous default preset to the existing minimum; retain all other configured delays.
ALTER TABLE app_settings ALTER COLUMN trigger_delay_ms SET DEFAULT 150;
UPDATE app_settings SET trigger_delay_ms = 150 WHERE id = 1 AND trigger_delay_ms = 200;
