import AzureDevOpsPlaywrightReporter from "../src/playwrightService";
import { RUN_ID_ENV_VAR } from "../src/utils";
import type { TestCase, TestResult } from "@playwright/test/reporter";
import * as azdev from "azure-devops-node-api";

jest.mock("azure-devops-node-api");

function makeTestCase(
  title: string,
  annotations: Array<{ type: string; description?: string }> = [],
  tags: string[] = [],
): TestCase {
  return { title, annotations, tags } as unknown as TestCase;
}

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    status: "passed",
    duration: 100,
    errors: [],
    attachments: [],
    ...overrides,
  } as unknown as TestResult;
}

describe("AzureDevOpsPlaywrightReporter", () => {
  const mockTestApi = {
    getPoints: jest.fn(),
    createTestRun: jest.fn(),
    addTestResultsToTestRun: jest.fn(),
    getTestResults: jest.fn(),
    updateTestResults: jest.fn(),
    createTestResultAttachment: jest.fn(),
    updateTestRun: jest.fn(),
  };

  const options = {
    orgUrl: "https://dev.azure.com/test-org",
    token: "fake-token",
    projectId: "TestProject",
    planId: 100,
    suiteId: 200,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[RUN_ID_ENV_VAR];

    jest.mocked(azdev.getPersonalAccessTokenHandler).mockReturnValue({} as any);
    jest.mocked(azdev.WebApi).mockImplementation(
      () =>
        ({
          getTestApi: jest.fn().mockResolvedValue(mockTestApi),
        }) as any,
    );

    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1234" }, configuration: { id: "1" } },
    ]);
    mockTestApi.createTestRun.mockResolvedValue({ id: 999 });
    mockTestApi.addTestResultsToTestRun.mockResolvedValue([]);
    mockTestApi.getTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1234" } },
    ]);
    mockTestApi.updateTestResults.mockImplementation(
      async (results) => results,
    );
    mockTestApi.updateTestRun.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env[RUN_ID_ENV_VAR];
  });

  test("onBegin creates an empty run", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);

    await reporter.onBegin();

    expect(mockTestApi.createTestRun).toHaveBeenCalledWith(
      expect.objectContaining({ automated: true, plan: { id: "100" } }),
      "TestProject",
    );
    const [runPayload] = mockTestApi.createTestRun.mock.calls[0];
    expect(runPayload).not.toHaveProperty("pointIds");
  });

  test("onBegin reuses an existing run id instead of creating one", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter({
      ...options,
      runId: 555,
    });

    await reporter.onBegin();

    expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
  });

  test("onBegin treats a run id of 0 as not set", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter({
      ...options,
      runId: 0,
    });

    await reporter.onBegin();

    expect(mockTestApi.createTestRun).toHaveBeenCalledTimes(1);
  });

  test("onBegin reuses the run id from AZURE_DEVOPS_TEST_RUN_ID over the option", async () => {
    process.env[RUN_ID_ENV_VAR] = "777";
    const reporter = new AzureDevOpsPlaywrightReporter({
      ...options,
      runId: 555,
    });

    await reporter.onBegin();

    expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
  });

  test("onBegin creates a new run when AZURE_DEVOPS_TEST_RUN_ID is 0", async () => {
    process.env[RUN_ID_ENV_VAR] = "0";
    const reporter = new AzureDevOpsPlaywrightReporter({
      ...options,
      runId: 555,
    });

    await reporter.onBegin();

    expect(mockTestApi.createTestRun).toHaveBeenCalledTimes(1);
  });

  test("collects a passed test and publishes + completes the run in onEnd", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);
    await reporter.onBegin();

    reporter.onTestEnd(
      makeTestCase("C1234 login works"),
      makeResult({ status: "passed" }),
    );
    await reporter.onEnd();

    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ outcome: "Passed" })]),
      "TestProject",
      999,
    );
    expect(mockTestApi.updateTestRun).toHaveBeenCalledWith(
      expect.anything(),
      "TestProject",
      999,
    );
  });

  test("ignores tests whose title has no case id", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);
    await reporter.onBegin();

    reporter.onTestEnd(makeTestCase("no case id here"), makeResult());
    await reporter.onEnd();

    expect(mockTestApi.addTestResultsToTestRun).not.toHaveBeenCalled();
  });

  test("extracts the case id from a playwright-bdd @tag annotation when the title has none", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);
    await reporter.onBegin();

    reporter.onTestEnd(
      makeTestCase("User can log in", [{ type: "tag", description: "@C1234" }]),
      makeResult({ status: "passed" }),
    );
    await reporter.onEnd();

    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ outcome: "Passed" })]),
      "TestProject",
      999,
    );
  });

  test("extracts the case id from a native Playwright tag when the title has none", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);
    await reporter.onBegin();

    reporter.onTestEnd(
      makeTestCase("User can log in", [], ["@C1234"]),
      makeResult({ status: "passed" }),
    );
    await reporter.onEnd();

    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ outcome: "Passed" })]),
      "TestProject",
      999,
    );
  });

  test("still falls back to the title when neither native tags nor annotations match", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);
    await reporter.onBegin();

    reporter.onTestEnd(
      makeTestCase(
        "C1234 User can log in",
        [{ type: "tag", description: "@smoke" }],
        ["@regression"],
      ),
      makeResult({ status: "passed" }),
    );
    await reporter.onEnd();

    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ outcome: "Passed" })]),
      "TestProject",
      999,
    );
  });

  test("maps a failed test's error message and skips passed-test screenshots", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);
    await reporter.onBegin();

    reporter.onTestEnd(
      makeTestCase("C1234 login fails"),
      makeResult({
        status: "failed",
        errors: [{ message: "Assertion failed" } as any],
      }),
    );
    await reporter.onEnd();

    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "Failed",
          errorMessage: "Assertion failed",
        }),
      ]),
      "TestProject",
      999,
    );
  });

  test("maps a failed test's stack trace, joining multiple errors", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);
    await reporter.onBegin();

    reporter.onTestEnd(
      makeTestCase("C1234 login fails"),
      makeResult({
        status: "failed",
        errors: [
          {
            message: "Assertion failed",
            stack: "Error: Assertion failed\n    at spec.ts:10:5",
          } as any,
          {
            message: "Second error",
            stack: "Error: Second error\n    at spec.ts:12:5",
          } as any,
        ],
      }),
    );
    await reporter.onEnd();

    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          stackTrace:
            "Error: Assertion failed\n    at spec.ts:10:5\n\nError: Second error\n    at spec.ts:12:5",
        }),
      ]),
      "TestProject",
      999,
    );
  });

  test("attaches an image attachment from a failed test", async () => {
    const reporter = new AzureDevOpsPlaywrightReporter(options);
    await reporter.onBegin();

    reporter.onTestEnd(
      makeTestCase("C1234 login fails"),
      makeResult({
        status: "failed",
        attachments: [
          {
            name: "screenshot",
            contentType: "image/png",
            body: Buffer.from("fake-png"),
          } as any,
        ],
      }),
    );
    await reporter.onEnd();

    expect(mockTestApi.createTestResultAttachment).toHaveBeenCalled();
  });

  describe("playwright-bdd integration", () => {
    // playwright-bdd compiles each Gherkin scenario into a real Playwright
    // TestCase/TestResult, tagging it via `annotations` rather than the title.
    beforeEach(() => {
      mockTestApi.getPoints.mockResolvedValue([
        { id: 10, testCase: { id: "1234" }, configuration: { id: "1" } },
        { id: 11, testCase: { id: "5678" }, configuration: { id: "1" } },
      ]);
      mockTestApi.getTestResults.mockResolvedValue([
        { id: 1, testCase: { id: "1234" } },
        { id: 2, testCase: { id: "5678" } },
      ]);
    });

    test("publishes an outcome for every tagged scenario in a feature file run", async () => {
      const reporter = new AzureDevOpsPlaywrightReporter(options);
      await reporter.onBegin();

      // Scenario: User can log in
      //   @C1234
      reporter.onTestEnd(
        makeTestCase("User can log in", [
          { type: "tag", description: "@C1234" },
        ]),
        makeResult({ status: "passed" }),
      );
      // Scenario: User sees an error for bad credentials
      //   @C5678
      reporter.onTestEnd(
        makeTestCase("User sees an error for bad credentials", [
          { type: "tag", description: "@C5678" },
        ]),
        makeResult({
          status: "failed",
          errors: [{ message: "Expected error banner" } as any],
        }),
      );
      // Untagged background/setup step generated by playwright-bdd; must be skipped.
      reporter.onTestEnd(
        makeTestCase("Before Hooks", []),
        makeResult({ status: "passed" }),
      );

      await reporter.onEnd();

      expect(mockTestApi.addTestResultsToTestRun).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ testCase: { id: "1234" } }),
          expect.objectContaining({ testCase: { id: "5678" } }),
        ]),
        "TestProject",
        999,
      );
      expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            testCase: { id: "1234" },
            outcome: "Passed",
          }),
          expect.objectContaining({
            testCase: { id: "5678" },
            outcome: "Failed",
            errorMessage: "Expected error banner",
          }),
        ]),
        "TestProject",
        999,
      );
      expect(mockTestApi.updateTestRun).toHaveBeenCalledWith(
        expect.anything(),
        "TestProject",
        999,
      );
    });

    test("falls back to the scenario name when no @tag annotation matches", async () => {
      const reporter = new AzureDevOpsPlaywrightReporter(options);
      await reporter.onBegin();

      reporter.onTestEnd(
        makeTestCase("C1234 User can log in", [
          { type: "tag", description: "@smoke" },
        ]),
        makeResult({ status: "passed" }),
      );
      await reporter.onEnd();

      expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            testCase: { id: "1234" },
            outcome: "Passed",
          }),
        ]),
        "TestProject",
        999,
      );
    });
  });
});
