const assert = require("node:assert/strict");
const test = require("node:test");
const { getDiagnosticGuidance } = require("../out/qc1/diagnosticGuidance");

test("guided diagnostics propose manual next steps for common tool and hardware errors", () => {
  assert.equal(getDiagnosticGuidance({ code: "QC1-H755-020", title: "GCC_ARM_INTROUVABLE" })[0].id, "toolchain-missing");
  assert.equal(getDiagnosticGuidance({ title: "ST-Link non détecté" })[0].id, "stlink-missing");
  assert.equal(getDiagnosticGuidance({ message: "Port série déjà occupé par screen" })[0].id, "serial-busy");
  assert.equal(getDiagnosticGuidance({ message: "OpenOCD port 3333 address in use" })[0].id, "openocd-conflict");
  assert.equal(getDiagnosticGuidance({ title: "Reset non confirmé" })[0].id, "reset-unconfirmed");
});

test("diagnostic guidance leaves unknown text without invented repairs", () => {
  assert.deepEqual(getDiagnosticGuidance({ code: "CUSTOM-001", message: "Condition inconnue" }), []);
  const suggestions = getDiagnosticGuidance({ message: "Vérification Flash échouée" });
  assert.equal(suggestions[0].id, "verification-failed");
  assert.match(suggestions[0].steps[0], /Ne considère pas/);
});
