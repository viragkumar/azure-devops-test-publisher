import { AzureDevOpsWdioService, RUN_ID_ENV_VAR } from "../src/wdioService";
import * as azdev from "azure-devops-node-api";

jest.mock("azure-devops-node-api");

describe("AzureDevOpsWdioService", () => {
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
      { id: 11, testCase: { id: "5678" }, configuration: { id: "2" } },
    ]);
    mockTestApi.createTestRun.mockResolvedValue({ id: 999 });
    mockTestApi.addTestResultsToTestRun.mockResolvedValue([]);
    mockTestApi.updateTestResults.mockImplementation(
      async (results) => results,
    );
  });

  afterEach(() => {
    delete process.env[RUN_ID_ENV_VAR];
    delete (globalThis as any).browser;
  });

  describe("onPrepare / onComplete", () => {
    test("onPrepare creates one empty run and shares its id", async () => {
      const service = new AzureDevOpsWdioService(options);

      await service.onPrepare();

      expect(mockTestApi.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({
          automated: true,
          plan: { id: "100" },
        }),
        "TestProject",
      );
      const [runPayload] = mockTestApi.createTestRun.mock.calls[0];
      expect(runPayload).not.toHaveProperty("pointIds");
      expect(process.env[RUN_ID_ENV_VAR]).toBe("999");
    });

    test("onPrepare reuses the run id from the options instead of creating one", async () => {
      const service = new AzureDevOpsWdioService({ ...options, runId: 555 });

      await service.onPrepare();

      expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
      expect(process.env[RUN_ID_ENV_VAR]).toBe("555");
    });

    test("onPrepare reuses the run id already present in the env var", async () => {
      process.env[RUN_ID_ENV_VAR] = "777";
      const service = new AzureDevOpsWdioService(options);

      await service.onPrepare();

      expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
      expect(process.env[RUN_ID_ENV_VAR]).toBe("777");
    });

    test("onPrepare treats a run id of 0 as not set", async () => {
      const service = new AzureDevOpsWdioService({ ...options, runId: 0 });

      await service.onPrepare();

      expect(mockTestApi.createTestRun).toHaveBeenCalledTimes(1);
      expect(process.env[RUN_ID_ENV_VAR]).toBe("999");
    });

    test("onComplete completes the shared run and clears the env var", async () => {
      process.env[RUN_ID_ENV_VAR] = "999";
      const service = new AzureDevOpsWdioService(options);

      await service.onComplete();

      expect(mockTestApi.updateTestRun).toHaveBeenCalledWith(
        { state: "Completed" },
        "TestProject",
        999,
      );
      expect(process.env[RUN_ID_ENV_VAR]).toBeUndefined();
    });

    test("onComplete does nothing when no run was created", async () => {
      const service = new AzureDevOpsWdioService(options);

      await service.onComplete();

      expect(mockTestApi.updateTestRun).not.toHaveBeenCalled();
    });
  });

  describe("afterTest (Mocha specs)", () => {
    test("afterTest results are published into the run created by onPrepare", async () => {
      mockTestApi.getTestResults.mockResolvedValueOnce([]).mockResolvedValue([
        { id: 1, testCase: { id: "1234" } },
        { id: 2, testCase: { id: "5678" } },
      ]);

      const service = new AzureDevOpsWdioService(options);
      await service.onPrepare();

      await service.afterTest(
        { title: "C1234 login" },
        {},
        {
          passed: true,
          duration: 120,
        },
      );
      await service.afterTest(
        { title: "C5678 checkout" },
        {},
        {
          passed: false,
          duration: 340,
          error: new Error("boom"),
        },
      );
      await service.after();

      expect(mockTestApi.createTestRun).toHaveBeenCalledTimes(1);
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
            id: 1,
            outcome: "Passed",
            durationInMs: 120,
          }),
          expect.objectContaining({
            id: 2,
            outcome: "Failed",
            errorMessage: "boom",
            durationInMs: 340,
          }),
        ]),
        "TestProject",
        999,
      );
      // The run stays open so other workers can keep adding results.
      expect(mockTestApi.updateTestRun).not.toHaveBeenCalled();
    });

    test("publishing from a worker reuses the run id from the environment", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      mockTestApi.getTestResults
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 1, testCase: { id: "1234" } }]);

      const worker = new AzureDevOpsWdioService(options);

      await worker.afterTest(
        { title: "C1234 login" },
        {},
        {
          passed: true,
          duration: 10,
        },
      );
      await worker.after();

      expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
      expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
        expect.any(Array),
        "TestProject",
        555,
      );
    });

    test("attaches a screenshot for failed tests", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      (globalThis as any).browser = {
        takeScreenshot: jest.fn().mockResolvedValue("base64Screenshot"),
      };
      mockTestApi.getTestResults
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 1, testCase: { id: "1234" } }]);

      const service = new AzureDevOpsWdioService(options);

      await service.afterTest(
        { title: "C1234 login" },
        {},
        {
          passed: false,
          duration: 10,
          error: new Error("failed"),
        },
      );
      await service.after();

      expect(mockTestApi.createTestResultAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "failure-C1234.png",
          stream: "base64Screenshot",
        }),
        "TestProject",
        555,
        1,
      );
    });

    test("skips screenshots when screenshotOnFailure is disabled", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      const takeScreenshot = jest.fn();
      (globalThis as any).browser = { takeScreenshot };
      mockTestApi.getTestResults
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 1, testCase: { id: "1234" } }]);

      const service = new AzureDevOpsWdioService({
        ...options,
        screenshotOnFailure: false,
      });

      await service.afterTest(
        { title: "C1234 login" },
        {},
        {
          passed: false,
          duration: 10,
          error: new Error("failed"),
        },
      );
      await service.after();

      expect(takeScreenshot).not.toHaveBeenCalled();
      expect(mockTestApi.createTestResultAttachment).not.toHaveBeenCalled();
    });

    test("ignores tests without a case id in the title", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      const service = new AzureDevOpsWdioService(options);

      await service.afterTest(
        { title: "untagged test" },
        {},
        {
          passed: true,
          duration: 10,
        },
      );
      await service.after();

      expect(mockTestApi.getPoints).not.toHaveBeenCalled();
      expect(mockTestApi.updateTestResults).not.toHaveBeenCalled();
    });

    test("publish failures do not break the run", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockTestApi.getPoints.mockRejectedValue(new Error("network down"));

      const service = new AzureDevOpsWdioService(options);
      await service.afterTest(
        { title: "C1234 login" },
        {},
        {
          passed: true,
          duration: 10,
        },
      );

      await expect(service.after()).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to publish results to Azure DevOps:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("afterScenario (Cucumber / BDD feature files)", () => {
    test("afterScenario reads the case id from a Cucumber scenario tag", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      mockTestApi.getTestResults
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 1, testCase: { id: "1234" } }]);

      const service = new AzureDevOpsWdioService(options);

      await service.afterScenario(
        {
          pickle: { name: "Login scenario", tags: [{ name: "@C1234" }] },
        },
        { passed: true, duration: 250 },
      );
      await service.after();

      expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            outcome: "Passed",
            durationInMs: 250,
          }),
        ]),
        "TestProject",
        555,
      );
    });

    test("afterScenario falls back to the scenario name when no tag has a case id", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      mockTestApi.getTestResults
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 1, testCase: { id: "1234" } }]);

      const service = new AzureDevOpsWdioService(options);

      await service.afterScenario(
        { pickle: { name: "C1234 login scenario" } },
        { passed: false, duration: 50, error: new Error("boom") },
      );
      await service.after();

      expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            outcome: "Failed",
            errorMessage: "boom",
            durationInMs: 50,
          }),
        ]),
        "TestProject",
        555,
      );
    });

    test("afterScenario ignores scenarios without a case id", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      const service = new AzureDevOpsWdioService(options);

      await service.afterScenario(
        { pickle: { name: "untagged scenario" } },
        { passed: true, duration: 10 },
      );
      await service.after();

      expect(mockTestApi.getPoints).not.toHaveBeenCalled();
      expect(mockTestApi.updateTestResults).not.toHaveBeenCalled();
    });

    test("afterScenario attaches a screenshot for failed scenarios", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      (globalThis as any).browser = {
        takeScreenshot: jest.fn().mockResolvedValue("base64Screenshot"),
      };
      mockTestApi.getTestResults
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 1, testCase: { id: "1234" } }]);

      const service = new AzureDevOpsWdioService(options);

      await service.afterScenario(
        { pickle: { name: "Login scenario", tags: [{ name: "@C1234" }] } },
        { passed: false, duration: 10, error: new Error("failed") },
      );
      await service.after();

      expect(mockTestApi.createTestResultAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: "failure-C1234.png",
          stream: "base64Screenshot",
        }),
        "TestProject",
        555,
        1,
      );
    });
  });

  describe("caseIdPattern option", () => {
    test("uses a custom caseIdPattern to extract the case id from the title", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      mockTestApi.getTestResults
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 1, testCase: { id: "1234" } }]);

      const service = new AzureDevOpsWdioService({
        ...options,
        caseIdPattern: /TC-(\d+)/,
      });

      await service.afterTest(
        { title: "TC-1234 login" },
        {},
        {
          passed: true,
          duration: 10,
        },
      );
      await service.after();

      expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 1, outcome: "Passed" }),
        ]),
        "TestProject",
        555,
      );
    });

    test("uses a custom caseIdPattern to extract the case id from a Cucumber tag", async () => {
      process.env[RUN_ID_ENV_VAR] = "555";
      mockTestApi.getTestResults
        .mockResolvedValueOnce([])
        .mockResolvedValue([{ id: 1, testCase: { id: "1234" } }]);

      const service = new AzureDevOpsWdioService({
        ...options,
        caseIdPattern: /TC-(\d+)/,
      });

      await service.afterScenario(
        { pickle: { name: "Login scenario", tags: [{ name: "@TC-1234" }] } },
        { passed: true, duration: 10 },
      );
      await service.after();

      expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 1, outcome: "Passed" }),
        ]),
        "TestProject",
        555,
      );
    });
  });
});
