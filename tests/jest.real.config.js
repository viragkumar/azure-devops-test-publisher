const base = require("./jest.config.js");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...base,
  testMatch: ["**/tests/**/*.real.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
};
