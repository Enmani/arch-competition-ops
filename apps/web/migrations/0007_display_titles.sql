-- Derived display titles. `title` stays the source's own wording (the evidence); these columns hold a
-- cleaned, shorter, uniformly formatted rendering for cards and headings. NULL means "not derived yet":
-- readers fall back to the next column and finally to `title`.
--   display_title        rule-cleaned title in the source language (always set once cleaned)
--   display_title_zh/en  AI-condensed titles, only for titles still too long after cleaning
--   display_title_source which cleaner/model produced the columns, so a new version re-derives them
ALTER TABLE competitions ADD COLUMN display_title TEXT;
ALTER TABLE competitions ADD COLUMN display_title_zh TEXT;
ALTER TABLE competitions ADD COLUMN display_title_en TEXT;
ALTER TABLE competitions ADD COLUMN display_title_source TEXT;
