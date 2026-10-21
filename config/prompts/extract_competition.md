# Extract Competition Record

Normalize the page or brief into the repository schema.

Requirements:

- keep `source_url`; write `official_url` only when the notice links to an official page
- `organizer` is the buyer named in the notice, or empty; never the publishing platform
- fees are `null` unless the notice states them (`0` only for an explicit "free")
- use explicit evidence only
- leave fields empty when not stated
- capture uncertainty in `evidence_note`
- if a date is ambiguous, copy the exact wording into `evidence_note`
