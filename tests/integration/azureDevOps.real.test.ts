import { AzureDevOpsReporterService } from "../../src/index";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
// Real end-to-end test against a live Azure DevOps org - no mocks.
// Requires these env vars to be set, otherwise the suite is skipped:
//   AZURE_ORG_URL     e.g. https://dev.azure.com/your-org
//   AZURE_PAT         a Personal Access Token with Test Management (Read & Write) scope
//   AZURE_PROJECT     project name
//   AZURE_PLAN_ID     an existing Test Plan id
//   AZURE_SUITE_ID    an existing Test Suite id (must contain AZURE_TEST_CASE_ID)
//   AZURE_TEST_CASE_ID  id of a Test Case included in the suite above
//
// Run with: npm run test:integration
const {
  AZURE_ORG_URL,
  AZURE_PAT,
  AZURE_PROJECT,
  AZURE_PLAN_ID,
  AZURE_SUITE_ID,
  AZURE_TEST_CASE_ID,
} = process.env;

const hasRealCredentials =
  AZURE_ORG_URL &&
  AZURE_PAT &&
  AZURE_PROJECT &&
  AZURE_PLAN_ID &&
  AZURE_SUITE_ID &&
  AZURE_TEST_CASE_ID;

const describeIfConfigured = hasRealCredentials ? describe : describe.skip;

describeIfConfigured("AzureDevOpsReporterService (real Azure DevOps)", () => {
  jest.setTimeout(30000);

  test("publishes a passing result for a real test case to Azure DevOps", async () => {
    const service = new AzureDevOpsReporterService({
      orgUrl: AZURE_ORG_URL!,
      token: AZURE_PAT!,
      projectName: AZURE_PROJECT!,
      planId: parseInt(AZURE_PLAN_ID!, 10),
      suiteId: parseInt(AZURE_SUITE_ID!, 10),
    });

    await service.afterTest(
      { title: `C${AZURE_TEST_CASE_ID} real integration test`, duration: 42 },
      {},
      { passed: true },
    );

    // Throws if Azure DevOps rejects the request (auth, missing plan/suite, etc.).
    await expect(service.onComplete()).resolves.not.toThrow();
  });
});
