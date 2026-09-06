/** Shares a Test Run id across processes/reporters via an environment variable. */
export const RUN_ID_ENV_VAR = "AZURE_DEVOPS_TEST_RUN_ID";

/**
 * Reads the Azure DevOps case id out of a test title tagged with `C123` or `#123`.
 * Pass a custom `pattern` (with a capturing group for the numeric id) to override the default.
 *
 * `tags` (e.g. Cucumber/playwright-bdd `@C123` tags) are checked before the title, since
 * BDD frameworks often carry the case id there instead of in the scenario name.
 */
export function extractTestCaseId(
  title: string,
  pattern?: RegExp,
  tags?: string[],
): number | null {
  for (const tag of tags ?? []) {
    const caseId = matchCaseId(tag, pattern);
    if (caseId) return caseId;
  }
  return matchCaseId(title, pattern);
}

function matchCaseId(text: string, pattern?: RegExp): number | null {
  const match = pattern
    ? text.match(pattern)
    : text.match(/C(\d+)/i) || text.match(/#(\d+)/);

  if (!match?.[1]) return null;

  const caseId = parseInt(match[1], 10);
  return Number.isNaN(caseId) ? null : caseId;
}
