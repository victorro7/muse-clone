// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Disabled: eslint-plugin-import cannot resolve @typescript-eslint/parser
    // in this environment, so the rule only reports tooling noise, not code issues.
    rules: { "import/namespace": "off" },
  }
]);
