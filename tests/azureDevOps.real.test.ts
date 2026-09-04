import {
  AzureDevOpsReporterService,
  AzureDevOpsService,
  AzureDevOpsWdioService,
  RUN_ID_ENV_VAR,
} from "../src/index";
import * as azdev from "azure-devops-node-api";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
// Real end-to-end test against a live Azure DevOps org - no mocks.
// Requires these env vars to be set, otherwise the suite is skipped:
//   AZURE_ORG_URL     e.g. https://dev.azure.com/your-org
//   AZURE_PAT         a Personal Access Token with Test Management (Read & Write) scope
//   AZURE_PROJECT     project name
//   AZURE_PLAN_ID     an existing Test Plan id
//   AZURE_SUITE_ID    an existing Test Suite id (must contain AZURE_TEST_CASE_ID)
//   AZURE_TEST_CASE_ID  id of a Test Case included in the suite above
//   AZURE_TEST_CASE_ID_2  (optional) a second Test Case id used by the reused-run test
//
// Run with: npm run test:integration
const {
  AZURE_ORG_URL,
  AZURE_PAT,
  AZURE_PROJECT,
  AZURE_PLAN_ID,
  AZURE_SUITE_ID,
  AZURE_TEST_CASE_ID,
  AZURE_TEST_CASE_ID_2,
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

  test("publishes two batches into a single reused test run", async () => {
    const service = new AzureDevOpsService({
      orgUrl: AZURE_ORG_URL!,
      token: AZURE_PAT!,
      projectName: AZURE_PROJECT!,
      planId: parseInt(AZURE_PLAN_ID!, 10),
      suiteId: parseInt(AZURE_SUITE_ID!, 10),
      runName: `Reused run - ${new Date().toISOString()}`,
      reuseTestRun: true,
    });

    const caseId = parseInt(AZURE_TEST_CASE_ID!, 10);
    const secondCaseId = AZURE_TEST_CASE_ID_2
      ? parseInt(AZURE_TEST_CASE_ID_2, 10)
      : caseId;

    const firstRunId = await service.publishResults([
      { testCaseId: caseId, outcome: "Passed", durationInMs: 42 },
    ]);
    const secondRunId = await service.publishResults([
      {
        testCaseId: secondCaseId,
        outcome: "Failed",
        errorMessage: "Second batch failure",
        durationInMs: 84,
      },
    ]);

    expect(firstRunId).toBeDefined();
    expect(secondRunId).toBe(firstRunId);

    await service.completeRun();
    expect(service.runId).toBeUndefined();

    // Verify in Azure DevOps that the single run holds both outcomes.
    const connection = new azdev.WebApi(
      AZURE_ORG_URL!,
      azdev.getPersonalAccessTokenHandler(AZURE_PAT!),
    );
    const testApi = await connection.getTestApi();
    const run = await testApi.getTestRunById(AZURE_PROJECT!, firstRunId!);
    const runResults = await testApi.getTestResults(
      AZURE_PROJECT!,
      firstRunId!,
    );

    expect(run.state).toBe("Completed");
    expect(runResults.map((r) => r.testCase?.id).filter(Boolean)).toEqual(
      expect.arrayContaining([caseId.toString(), secondCaseId.toString()]),
    );
    expect(runResults.some((r) => r.outcome === "Failed")).toBe(true);
  });

  test("wdio service hooks publish every spec into one run", async () => {
    const runIdBackup = process.env[RUN_ID_ENV_VAR];
    delete process.env[RUN_ID_ENV_VAR];

    const service = new AzureDevOpsWdioService({
      orgUrl: AZURE_ORG_URL!,
      token: AZURE_PAT!,
      projectName: AZURE_PROJECT!,
      planId: parseInt(AZURE_PLAN_ID!, 10),
      suiteId: parseInt(AZURE_SUITE_ID!, 10),
      runName: `WDIO run - ${new Date().toISOString()}`,
    });

    const caseId = parseInt(AZURE_TEST_CASE_ID!, 10);
    const secondCaseId = AZURE_TEST_CASE_ID_2
      ? parseInt(AZURE_TEST_CASE_ID_2, 10)
      : caseId;

    await service.onPrepare();
    const runId = parseInt(process.env[RUN_ID_ENV_VAR]!, 10);
    expect(runId).toBeGreaterThan(0);

    // First spec worker.
    await service.afterTest(
      { title: `C${caseId} wdio first spec` },
      {},
      { passed: true, duration: 42 },
    );
    await service.after();

    // Second spec worker.
    await service.afterTest(
      { title: `C${secondCaseId} wdio second spec` },
      {},
      { passed: false, duration: 84, error: new Error("wdio failure") },
    );
    await service.after();

    await service.onComplete();

    const connection = new azdev.WebApi(
      AZURE_ORG_URL!,
      azdev.getPersonalAccessTokenHandler(AZURE_PAT!),
    );
    const testApi = await connection.getTestApi();
    const run = await testApi.getTestRunById(AZURE_PROJECT!, runId);
    const runResults = await testApi.getTestResults(AZURE_PROJECT!, runId);

    expect(run.state).toBe("Completed");
    expect(runResults.map((r) => r.testCase?.id)).toEqual(
      expect.arrayContaining([caseId.toString(), secondCaseId.toString()]),
    );
    expect(runResults.some((r) => r.outcome === "Failed")).toBe(true);
    expect(process.env[RUN_ID_ENV_VAR]).toBeUndefined();

    if (runIdBackup) process.env[RUN_ID_ENV_VAR] = runIdBackup;
  });
});
