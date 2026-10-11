-- Speeds up the canvas snapshot: the last event per position (GROUP BY position, MAX(id)).
CREATE INDEX idx_events_position_id ON events (position, id);
