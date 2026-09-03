-- Manual migration untuk fix error "column last_hit_at does not exist"
-- Jalankan di Neon SQL Editor atau psql

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_limit INT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_count INT NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_api_keys_last_hit ON api_keys(last_hit_at);

-- Verifikasi
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name='api_keys' AND column_name IN ('usage_limit','usage_count','last_hit_at','updated_at')
ORDER BY column_name;
