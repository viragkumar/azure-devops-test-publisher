/**
 * Reads the Azure DevOps case id out of a test title tagged with `C123` or `#123`.
 * Pass a custom `pattern` (with a capturing group for the numeric id) to override the default.
 */
export function extractTestCaseId(
  title: string,
  pattern?: RegExp,
): number | null {
  const match = pattern
    ? title.match(pattern)
    : title.match(/C(\d+)/i) || title.match(/#(\d+)/);

  if (!match?.[1]) return null;

  const caseId = parseInt(match[1], 10);
  return Number.isNaN(caseId) ? null : caseId;
}
