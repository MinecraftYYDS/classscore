-- 记录绝对分值(重置分数、直接设置分数时用于展示 "=X")
ALTER TABLE score_logs ADD COLUMN result INTEGER;
