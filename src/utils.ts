/**
 * Reads the Azure DevOps case id out of a test title tagged with `C123` or `#123`.
 * Pass a custom `pattern` (with a capturing group for the numeric id) to override the default.
 */
export function extractTestCaseId(
  title: string,
  pattern?: RegExp,
): number | null {
  if (pattern) {
    const match = title.match(pattern);
    return match ? parseInt(match[1], 10) : null;
  }

  const match = title.match(/C(\d+)/i) || title.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
