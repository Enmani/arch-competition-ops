ALTER TABLE competitions ADD COLUMN project_types TEXT NOT NULL DEFAULT '[]';
ALTER TABLE competitions ADD COLUMN building_categories TEXT NOT NULL DEFAULT '[]';
ALTER TABLE competitions ADD COLUMN official_sectors TEXT NOT NULL DEFAULT '[]';
ALTER TABLE competitions ADD COLUMN built_asset_types TEXT NOT NULL DEFAULT '[]';
ALTER TABLE competitions ADD COLUMN design_scopes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE competitions ADD COLUMN project_modes TEXT NOT NULL DEFAULT '[]';
