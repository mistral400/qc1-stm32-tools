const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const { qc1WindowScopedSettings } = require("../out/qc1/projectConfiguration");

test("QC1 settings declare scopes that match the extension accessors", () => {
  const properties = manifest.contributes.configuration[0].properties;
  for (const [qualifiedName, definition] of Object.entries(properties)) {
    const key = qualifiedName.replace(/^qc1\./, "");
    const expected = qc1WindowScopedSettings.has(key) ? "window" : "resource";
    assert.equal(definition.scope, expected, `${qualifiedName} must be declared ${expected}-scoped`);
  }
});

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

test("UART runtime modules and native bindings are included by the VSIX file allowlist", () => {
  assert.equal(manifest.dependencies.serialport, "13.0.0");
  for (const pattern of [
    "node_modules/serialport/**",
    "node_modules/@serialport/**",
    "node_modules/debug/**",
    "node_modules/ms/**",
    "node_modules/node-addon-api/**",
    "node_modules/node-gyp-build/**",
  ]) assert.ok(manifest.files.includes(pattern), `missing VSIX file pattern ${pattern}`);
  assert.ok(fs.existsSync(path.join(root, "docs", "UART.md")));
});

test("hybrid explorer and editor dashboard are contributed and activated", () => {
  assert.ok(manifest.activationEvents.includes("onView:qc1.explorer"));
  assert.ok(manifest.activationEvents.includes("onCommand:qc1.openDashboard"));
  assert.ok(manifest.contributes.views.qc1.some((view) => view.id === "qc1.explorer" && !view.type));
  assert.ok(manifest.contributes.views.qc1.some((view) => view.id === "qc1.panel" && view.type === "webview"));
  assert.ok(manifest.contributes.commands.some((command) => command.command === "qc1.openDashboard"));
  assert.ok(manifest.contributes.menus.commandPalette.some((entry) => entry.command === "qc1.openDashboard"));
});
