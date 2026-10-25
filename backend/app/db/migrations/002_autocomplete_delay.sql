-- Lower the original 400 ms preset; retain all other configured delays.
ALTER TABLE app_settings ALTER COLUMN trigger_delay_ms SET DEFAULT 200;
UPDATE app_settings SET trigger_delay_ms = 200 WHERE id = 1 AND trigger_delay_ms = 400;
