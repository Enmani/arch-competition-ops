import assert from "node:assert/strict";
import test from "node:test";

import { locales } from "../config";
import { dictionaries } from "./index";

/** Flattens a dictionary into `path -> string`; array items get index segments. */
const flatten = (value: unknown): Map<string, string> => {
  const out = new Map<string, string>();
  const visit = (node: unknown, path: string) => {
    if (typeof node === "string") {
      out.set(path, node);
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        visit(child, path ? `${path}.${key}` : key);
      }
    } else {
      assert.fail(`${path} is not a string, array or object (${typeof node})`);
    }
  };
  visit(value, "");
  return out;
};

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

const reference = flatten(dictionaries.zh);

test("every locale has exactly the key set of the zh source dictionary", () => {
  for (const locale of locales) {
    const keys = [...flatten(dictionaries[locale]).keys()].sort();
    assert.deepEqual(keys, [...reference.keys()].sort(), `${locale} key set differs from zh`);
  }
});

test("no dictionary string is blank", () => {
  for (const locale of locales) {
    for (const [path, text] of flatten(dictionaries[locale])) {
      assert.notEqual(text.trim(), "", `${locale}:${path} is blank`);
    }
  }
});

test("template placeholders match across locales", () => {
  for (const locale of locales) {
    const own = flatten(dictionaries[locale]);
    for (const [path, text] of reference) {
      assert.deepEqual(placeholders(own.get(path) ?? ""), placeholders(text), `${locale}:${path} placeholders`);
    }
  }
});

test("each locale declares a distinct Open Graph locale", () => {
  const ogLocales = locales.map((locale) => dictionaries[locale].meta.ogLocale);
  assert.equal(new Set(ogLocales).size, locales.length);
});
