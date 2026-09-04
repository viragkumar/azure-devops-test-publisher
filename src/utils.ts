/** Reads the Azure DevOps case id out of a test title tagged with `C123` or `#123`. */
export function extractTestCaseId(title: string): number | null {
  const match = title.match(/C(\d+)/i) || title.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
