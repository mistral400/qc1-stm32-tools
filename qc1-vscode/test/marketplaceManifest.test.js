const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("optional integrations are bundled without a blocking extension dependency", () => {
  assert.equal(manifest.extensionDependencies, undefined);
  assert.deepEqual(manifest.extensionPack, ["mylonics.embedded-build-tools", "marus25.cortex-debug"]);
  assert.ok(!manifest.extensionPack.includes("ms-vscode.cmake-tools"));
});

test("Marketplace metadata and probe selection command are packaged", () => {
  assert.equal(manifest.license, "SEE LICENSE IN LICENSE");
  assert.equal(manifest.categories.includes("Other"), true);
  assert.equal(manifest.categories.includes("Extension Packs"), true);
  assert.ok(manifest.keywords.includes("STM32"));
  assert.ok(fs.existsSync(path.join(root, manifest.icon)));
  assert.ok(manifest.contributes.commands.some((command) => command.command === "qc1.selectStlink"));
  assert.ok(manifest.contributes.menus.commandPalette.some((entry) => entry.command === "qc1.selectStlink"));
  assert.ok(manifest.files.includes("docs/**"));
  for (const file of ["ARCHITECTURE.md", "INSTALLATION.md", "BUILD_FLASH_DEBUG.md", "MULTI_PROJECT.md", "DIAGNOSTICS.md", "TESTING.md", "COMPATIBILITY_MATRIX.md", "MARKETPLACE_READINESS.md", "QC1_AUDIT.md"])
    assert.ok(fs.existsSync(path.join(root, "docs", file)), `missing docs/${file}`);
});

test("hybrid explorer and editor dashboard are contributed and activated", () => {
  assert.ok(manifest.activationEvents.includes("onView:qc1.explorer"));
  assert.ok(manifest.activationEvents.includes("onCommand:qc1.openDashboard"));
  assert.ok(manifest.contributes.views.qc1.some((view) => view.id === "qc1.explorer" && !view.type));
  assert.ok(manifest.contributes.views.qc1.some((view) => view.id === "qc1.panel" && view.type === "webview"));
  assert.ok(manifest.contributes.commands.some((command) => command.command === "qc1.openDashboard"));
  assert.ok(manifest.contributes.menus.commandPalette.some((entry) => entry.command === "qc1.openDashboard"));
});
