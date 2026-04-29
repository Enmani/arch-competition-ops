# Verify Mode

Goal: check whether a discovered record is trustworthy enough to become `verified`.

Workflow:

1. compare official procurement notices and authority pages against any secondary discovery text
2. confirm deadline wording
3. confirm procedure type and implementation path
4. confirm fee structure or absence of fees
5. confirm eligibility and licensed-architect signals
6. update `last_verified_at`

If core facts still conflict, keep the status below `verified`.
