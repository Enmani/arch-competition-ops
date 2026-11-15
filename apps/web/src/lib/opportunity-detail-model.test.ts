import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMissingInformation,
  countDeadline,
  humanizeExcerpt,
  isMachineNote,
  prettifyAmountText,
} from "./opportunity-detail-model";

test("missing information is sorted into plain topics and system remarks are dropped", () => {
  assert.deepEqual(
    classifyMissingInformation([
      "registration_fee_eur",
      "submission_fee",
      "design_contract_value",
      "licensed_architect_required",
      "architect eligibility",
      "architectural_design_scope",
      "brief/program",
      "Unsupported decision evidence: notice_text",
      "Input was truncated to the configured character limit",
      "Source page could not be fetched; structured record only",
      "submission_deadline",
      "local_partner_requirement",
      "something unrelated",
    ]),
    ["fees", "value", "qualification", "scope", "documents", "deadline", "localPartner"],
  );
});

test("a design fee is a fee, not a design scope", () => {
  assert.deepEqual(classifyMissingInformation(["design_fee"]), ["fees"]);
});

test("the deadline counts whole UTC days and names closed and same-day deadlines", () => {
  const now = new Date("2026-11-16T10:00:00Z");
  assert.deepEqual(countDeadline("2026-11-27T23:59:00Z", now), { days: 11, kind: "daysLeft" });
  assert.deepEqual(countDeadline("2026-11-16T01:00:00Z", now), { kind: "dueToday" });
  assert.deepEqual(countDeadline("2026-11-15T23:00:00Z", now), { kind: "closed" });
  assert.equal(countDeadline(null, now), null);
  assert.equal(countDeadline("not a date", now), null);
});

test("a bare machine field in an excerpt shows only its value, as a readable date", () => {
  assert.equal(humanizeExcerpt('"sluitingsDatum": "2026-12-02T12:00:00"', "en-GB"), "2 December 2026 12:00");
  assert.equal(humanizeExcerpt('"sluitingsDatum": "2026-12-02T00:00:00"', "zh-CN"), "2026年12月2日");
  assert.equal(humanizeExcerpt("Estimated value excluding VAT : 920 000,00 EUR", "en-GB"), "Estimated value excluding VAT : 920 000,00 EUR");
  assert.equal(humanizeExcerpt("EUR 300.000", "en-GB"), "EUR 300.000");
});

test("internal source dumps are not shown as notes", () => {
  assert.equal(isMachineNote("AI title [https://x.example/1]: Support on Nature AI organizer [https://x.example/1]: Ministry"), true);
  assert.equal(isMachineNote("The official portal lists a corrigendum dated 3 Nov."), false);
});

test("a plain stated amount gets digit grouping; amounts with their own separators stay as written", () => {
  assert.equal(prettifyAmountText("3000000.0 NOK", "en-GB"), "3,000,000 NOK");
  assert.equal(prettifyAmountText("3000000 NOK", "zh-CN"), "3,000,000 NOK");
  assert.equal(prettifyAmountText("920 000,00 EUR", "en-GB"), "920 000,00 EUR");
  assert.equal(prettifyAmountText("300.000 EUR", "en-GB"), "300.000 EUR");
  assert.equal(prettifyAmountText("Up to 5 prizes", "en-GB"), "Up to 5 prizes");
});
