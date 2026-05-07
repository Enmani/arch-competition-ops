ALTER TABLE competitions ADD COLUMN location_label TEXT;
ALTER TABLE competitions ADD COLUMN geo_lat REAL;
ALTER TABLE competitions ADD COLUMN geo_lng REAL;
ALTER TABLE competitions ADD COLUMN geo_source TEXT;
ALTER TABLE competitions ADD COLUMN geo_confidence REAL;
