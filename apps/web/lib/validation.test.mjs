// Run with: npm test (node --test --experimental-strip-types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { validationMessage } from "./validation.ts";

test("validation bubbles are Italian by default and Spanish on request", () => {
  const empty = { type: "text", validity: { valueMissing: true } };
  assert.equal(validationMessage(empty, "it"), "Compila questo campo.");
  assert.equal(validationMessage(empty, "es"), "Rellena este campo.");
  assert.equal(validationMessage({ type: "email", validity: { typeMismatch: true } }, "it"), "Inserisci un indirizzo email valido.");
  assert.equal(validationMessage({ type: "password", minLength: 10, value: "abc", validity: { tooShort: true } }, "it"),
    "Inserisci almeno 10 caratteri (ora 3).");
  assert.equal(validationMessage({ type: "checkbox", validity: { valueMissing: true } }, "it"), "Seleziona questa casella per continuare.");
  assert.equal(validationMessage({ type: "select-one", validity: { valueMissing: true } }, "it"), "Seleziona un’opzione.");
  assert.equal(validationMessage({ type: "text", validity: { valid: true } }, "it"), "");
});
