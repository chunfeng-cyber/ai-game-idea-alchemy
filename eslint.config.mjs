import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    // Ignore historical/generated cache files as well as the current build.
    ".next/**",
    ".vinext/**",
    ".wrangler/**",
    "dist/**",
    "out/**",
    "build/**",
    // Local staging, experiments and output archives are already excluded
    // from Git and the release package; active sources remain in worker/public/tests.
    "work/**",
    "outputs/**",
    ".alchemy-runtime/**",
    "public/generated/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    rules: {
      // TypeScript's rules add no value for the intentionally plain JS services.
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
]);

export default eslintConfig;
