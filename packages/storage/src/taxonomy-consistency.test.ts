import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  BUILDING_CATEGORIES,
  COMPETITION_STATUSES,
  DESIGN_SCOPES,
  EVIDENCE_LEVELS,
  IMPLEMENTATION_PATHS,
  OPPORTUNITY_TYPES,
  PROCEDURE_TYPES,
  PROJECT_MODES,
  PROJECT_TYPES,
} from "@arch-competition/core";

import { findRepoRoot } from "./node/paths";
import { procedureAliasGroups } from "./procedure-types";
import {
  evidenceLevelLabels,
  implementationPathLabels,
  opportunityTypeLabels,
  procedureLabels,
  statusLabels,
} from "./presentation";

const root = findRepoRoot();

/** config/taxonomy.yml only uses top-level keys with simple "- value" lists. */
const readTaxonomy = () => {
  const lists: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of readFileSync(path.join(root, "config", "taxonomy.yml"), "utf8").split(/\r?\n/)) {
    const key = /^([a-z_]+):\s*$/.exec(line);
    if (key) {
      current = key[1];
      lists[current] = [];
      continue;
    }
    const item = /^\s+-\s+"?([^"#]+?)"?\s*(?:#.*)?$/.exec(line);
    if (item && current) {
      lists[current].push(item[1]);
    }
  }
  return lists;
};

const sorted = (values: readonly string[]) => [...values].sort();
const taxonomy = readTaxonomy();

test("TypeScript vocabularies match config/taxonomy.yml", () => {
  assert.deepEqual(sorted(PROJECT_TYPES), sorted(taxonomy.project_types));
  assert.deepEqual(sorted(BUILDING_CATEGORIES), sorted(taxonomy.building_categories));
  assert.deepEqual(sorted(COMPETITION_STATUSES), sorted(taxonomy.competition_statuses));
  assert.deepEqual(sorted(EVIDENCE_LEVELS), sorted(taxonomy.evidence_levels));
  assert.deepEqual(sorted(OPPORTUNITY_TYPES), sorted(taxonomy.opportunity_types));
  assert.deepEqual(sorted(PROCEDURE_TYPES), sorted(taxonomy.procedure_types));
  assert.deepEqual(sorted(IMPLEMENTATION_PATHS), sorted(taxonomy.implementation_paths));
});

test("design scopes and project modes must match taxonomy.yml as soon as it defines them", () => {
  // The worker writes both from the GGZY collector but taxonomy.yml does not list them yet
  // (reported to the worker owner). When it does, this test starts enforcing equality.
  if (taxonomy.design_scopes) {
    assert.deepEqual(sorted(DESIGN_SCOPES), sorted(taxonomy.design_scopes));
  }
  if (taxonomy.project_modes) {
    assert.deepEqual(sorted(PROJECT_MODES), sorted(taxonomy.project_modes));
  }
  assert.ok(DESIGN_SCOPES.length > 0 && PROJECT_MODES.length > 0);
});

test("fallback label tables cover exactly the shared vocabularies", () => {
  assert.deepEqual(sorted(Object.keys(statusLabels)), sorted(COMPETITION_STATUSES));
  assert.deepEqual(sorted(Object.keys(evidenceLevelLabels)), sorted(EVIDENCE_LEVELS));
  assert.deepEqual(sorted(Object.keys(opportunityTypeLabels)), sorted(OPPORTUNITY_TYPES));
  assert.deepEqual(sorted(Object.keys(procedureLabels)), sorted(PROCEDURE_TYPES));
  assert.deepEqual(sorted(Object.keys(implementationPathLabels)), sorted(IMPLEMENTATION_PATHS));
});

test("every canonical procedure key in the alias registry is a taxonomy procedure type", () => {
  for (const key of Object.keys(procedureAliasGroups)) {
    assert.ok((PROCEDURE_TYPES as readonly string[]).includes(key), `${key} is not in taxonomy procedure_types`);
  }
});
