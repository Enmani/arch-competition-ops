import assert from "node:assert/strict";
import test from "node:test";

import { dictionaries } from "./dictionaries";
import {
  DATE_TIME_FORMAT,
  fillTemplate,
  formatDeadlineLabel,
  formatLocalizedDate,
  formatParticipationCost,
  formatStampLabel,
} from "./format";

test("fillTemplate replaces placeholders and leaves unknown ones visible", () => {
  assert.equal(fillTemplate("{shown} / {total}", { shown: 36, total: 120 }), "36 / 120");
  assert.equal(fillTemplate("{label}: {value}", { label: "A" }), "A: {value}");
});

test("a date-only deadline prints the same calendar day whatever the process time zone", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      assert.equal(formatLocalizedDate("en", "2026-11-03"), "3 Nov 2026", zone);
      assert.equal(formatLocalizedDate("zh", "2026-11-03"), "2026年11月3日", zone);
    }
  } finally {
    if (original === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = original;
    }
  }
});

test("an explicit timeZone option wins over the UTC default", () => {
  assert.equal(
    formatLocalizedDate("en", "2026-11-03T23:30:00Z", { dateStyle: "medium", timeZone: "Asia/Tokyo" }),
    "4 Nov 2026",
  );
});

test("date-time formatting names its zone so the reader never has to guess", () => {
  assert.match(formatLocalizedDate("en", "2026-11-03T09:05:00Z", DATE_TIME_FORMAT) ?? "", /UTC/);
});

test("empty and unparseable values degrade without throwing", () => {
  assert.equal(formatLocalizedDate("en", null), null);
  assert.equal(formatLocalizedDate("en", "soon"), "soon");
  assert.equal(formatDeadlineLabel("en", dictionaries.en, null), "Deadline pending");
  assert.equal(formatStampLabel("zh", dictionaries.zh, "capturedPrefix", undefined), "抓取于 待确认");
});

test("deadline labels use the locale prefix", () => {
  assert.equal(formatDeadlineLabel("en", dictionaries.en, "2026-11-03"), "Closes 3 Nov 2026");
  assert.equal(formatDeadlineLabel("zh", dictionaries.zh, "2026-11-03"), "截止 2026年11月3日");
});

test("an unknown (NULL) fee reads as pending, never as free", () => {
  assert.equal(formatParticipationCost("en", dictionaries.en, null, null), "Fee pending");
  assert.equal(formatParticipationCost("zh", dictionaries.zh, null, null), "费用待定");
});

test("only an explicit 0 reads as no participation fee", () => {
  assert.equal(formatParticipationCost("en", dictionaries.en, 0, 0), "No participation fee");
});

test("known amounts are listed and an explicit zero beside an unknown stays visible", () => {
  assert.match(formatParticipationCost("en", dictionaries.en, 50, null), /50.*registration/);
  assert.match(formatParticipationCost("en", dictionaries.en, 50, 20), /registration.*\/.*submission/);
  assert.match(formatParticipationCost("zh", dictionaries.zh, null, 20), /20.*提交/);
  assert.match(formatParticipationCost("en", dictionaries.en, 0, null), /0.*registration/);
});
