const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("packaged runtime contains no Liix or AI implementation", () => {
  const root = path.resolve(__dirname, "..");
  const aiOutput = path.join(root, "out", "ai");
  const files = fs.existsSync(aiOutput) ? fs.readdirSync(aiOutput) : [];
  assert.deepEqual(files, []);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const runtimeManifest = JSON.stringify({
    activationEvents: manifest.activationEvents,
    commands: manifest.contributes?.commands,
    views: manifest.contributes?.views,
    configuration: manifest.contributes?.configuration
  });
  assert.doesNotMatch(runtimeManifest, /liix|aiAgent|aiPanel|LM Studio/i);
});
