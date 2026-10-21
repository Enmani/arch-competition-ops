import assert from "node:assert/strict";
import test from "node:test";

import { buildLoginRedirect, sanitizeReturnPath } from "./return-path";

test("only locale-prefixed same-site paths survive", () => {
  assert.equal(sanitizeReturnPath("/en/ops?x=1#a", "zh"), "/en/ops?x=1#a");
  for (const hostile of ["//evil.com", "https://evil.com", "/\\evil.com", "/fr/x", "/api/auth/logout", "", "/en/\u0000"]) {
    assert.equal(sanitizeReturnPath(hostile, "zh"), "/zh/dashboard", hostile);
  }
  assert.equal(sanitizeReturnPath(undefined, "en"), "/en/dashboard");
});

test("the login redirect carries the encoded return path", () => {
  assert.equal(buildLoginRedirect("zh", "/zh/ops"), "/zh/login?next=%2Fzh%2Fops");
  assert.equal(buildLoginRedirect("zh", "//evil.com"), "/zh/login?next=%2Fzh%2Fdashboard");
});
