module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.json"],
    tsconfigRootDir: __dirname,
    sourceType: "module"
  },
  plugins: ["@typescript-eslint", "import", "unused-imports"],
  extends: ["airbnb-typescript/base", "prettier"],
  settings: {
    "import/resolver": {
      typescript: {}
    }
  },
  rules: {
    "@typescript-eslint/naming-convention": [
      "error",
      {
        selector: "variableLike",
        format: ["camelCase", "PascalCase", "UPPER_CASE"],
        leadingUnderscore: "allow"
      }
    ],
    "no-console": "off",
    "class-methods-use-this": "off",
    "import/prefer-default-export": "off",
    "@typescript-eslint/no-use-before-define": [
      "error",
      { "functions": false, "classes": true, "variables": true, "enums": true, "typedefs": true }
    ],
    "unused-imports/no-unused-imports": "error",
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-vars": [
      "warn",
      {
        "vars": "all",
        "varsIgnorePattern": "^_",
        "args": "after-used",
        "argsIgnorePattern": "^_"
      }
    ]
  },
  ignorePatterns: ["dist/", "ui/"]
};

