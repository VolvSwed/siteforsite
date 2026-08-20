import test from "node:test";
import assert from "node:assert/strict";
import { cleanEmail, cleanText, cleanUrl } from "../src/validation.js";

test("cleanEmail normalizes valid email", () => {
  assert.equal(cleanEmail("  CLIENT@EXAMPLE.BY "), "client@example.by");
});

test("cleanEmail rejects malformed input", () => {
  assert.equal(cleanEmail("not-an-email"), "");
});

test("cleanText trims, strips controls and limits length", () => {
  assert.equal(cleanText("  привет\u0000мир  ", 8), "приветми");
});

test("cleanUrl only accepts http and https", () => {
  assert.equal(cleanUrl("javascript:alert(1)"), null);
  assert.equal(cleanUrl("https://example.by/work"), "https://example.by/work");
  assert.equal(cleanUrl(""), "");
});
