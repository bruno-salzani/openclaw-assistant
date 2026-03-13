module.exports = {
  root: true,
  extends: ["next/core-web-vitals", "prettier"],
  plugins: ["unused-imports"],
  rules: {
    "unused-imports/no-unused-imports": "error",
  },
  ignorePatterns: [".next/", "out/", "node_modules/"],
};
