import globals from "globals";
import js from "@eslint/js";
import ts from "typescript-eslint";

export default ts.config(
  {
    files: ["**/*.config.js"],
    languageOptions: { globals: globals.commonjs },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.ts", "**/*.tsx", "**/*.mts"],
    languageOptions: { globals: globals.browser },
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
