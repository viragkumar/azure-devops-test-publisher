import { AzureDevOpsService } from "../src/azureService";
import * as azdev from "azure-devops-node-api";

jest.mock("azure-devops-node-api");

describe("AzureDevOpsService", () => {
  let service: AzureDevOpsService;

  const mockTestApi = {
    getPoints: jest.fn(),
    createTestRun: jest.fn(),
    addTestResultsToTestRun: jest.fn(),
    getTestResults: jest.fn(),
    updateTestResults: jest.fn(),
    createTestResultAttachment: jest.fn(),
    updateTestRun: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Safely cast mocked methods using jest.mocked()
    jest.mocked(azdev.getPersonalAccessTokenHandler).mockReturnValue({} as any);

    // Safely mock the WebApi class constructor
    jest.mocked(azdev.WebApi).mockImplementation(
      () =>
        ({
          getTestApi: jest.fn().mockResolvedValue(mockTestApi),
        }) as any,
    );

    service = new AzureDevOpsService({
      orgUrl: "https://dev.azure.com/test-org",
      token: "fake-token",
      projectId: "TestProject",
      planId: 100,
      suiteId: 200,
    });
  });

  test("should publish results and attach screenshots successfully", async () => {
    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1001" }, configuration: { id: "1" } },
    ]);
    mockTestApi.createTestRun.mockResolvedValue({ id: 999 });
    mockTestApi.getTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
    ]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
    ]);

    await service.publishResults([
      {
        testCaseId: 1001,
        outcome: "Failed",
        errorMessage: "Assertion failed",
        durationInMs: 1500,
        attachments: [
          {
            fileName: "screenshot.png",
            base64Content: "fake-base64",
            comment: "Failed screenshot",
          },
        ],
      },
    ]);

    // Verify test run creation passed configurationIds and pointIds
    expect(mockTestApi.createTestRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pointIds: [10],
        configurationIds: [1],
      }),
      "TestProject",
    );

    // Verify attachment creation
    expect(mockTestApi.createTestResultAttachment).toHaveBeenCalledWith(
      {
        fileName: "screenshot.png",
        stream: "fake-base64",
        comment: "Failed screenshot",
        attachmentType: "GeneralAttachment",
      },
      "TestProject",
      999,
      1,
    );

    // Verify run completion
    expect(mockTestApi.updateTestRun).toHaveBeenCalledWith(
      { state: "Completed" },
      "TestProject",
      999,
    );
  });

  test("should reuse an existing test run instead of creating one", async () => {
    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1001" }, configuration: { id: "1" } },
    ]);
    mockTestApi.addTestResultsToTestRun.mockResolvedValue([{ id: 1 }]);
    // The run holds no result for the case yet, then it does once added.
    mockTestApi.getTestResults
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: 1, testCase: { id: "1001" } }]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
    ]);

    const runId = await service.publishResults(
      [{ testCaseId: 1001, outcome: "Passed" }],
      { runId: 555 },
    );

    expect(runId).toBe(555);
    expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
    expect(mockTestApi.addTestResultsToTestRun).toHaveBeenCalledWith(
      [
        {
          testPoint: { id: "10" },
          testCase: { id: "1001" },
          configuration: { id: "1" },
        },
      ],
      "TestProject",
      555,
    );
    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ outcome: "Passed" })]),
      "TestProject",
      555,
    );
  });

  test("keeps a single run open across publishes when reuseTestRun is set", async () => {
    const reusingService = new AzureDevOpsService({
      orgUrl: "https://dev.azure.com/test-org",
      token: "fake-token",
      projectId: "TestProject",
      planId: 100,
      suiteId: 200,
      reuseTestRun: true,
    });

    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1001" }, configuration: { id: "1" } },
    ]);
    mockTestApi.createTestRun.mockResolvedValue({ id: 999 });
    mockTestApi.addTestResultsToTestRun.mockResolvedValue([{ id: 1 }]);
    mockTestApi.getTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" }, configuration: { id: "1" } },
    ]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" }, configuration: { id: "1" } },
    ]);

    await reusingService.publishResults([
      { testCaseId: 1001, outcome: "Passed" },
    ]);
    await reusingService.publishResults([
      { testCaseId: 1001, outcome: "Failed" },
    ]);

    expect(mockTestApi.createTestRun).toHaveBeenCalledTimes(1);
    // The run already has a result for the case, so nothing is added twice.
    expect(mockTestApi.addTestResultsToTestRun).not.toHaveBeenCalled();
    expect(mockTestApi.updateTestRun).not.toHaveBeenCalled();

    await reusingService.completeRun();

    expect(mockTestApi.updateTestRun).toHaveBeenCalledWith(
      { state: "Completed" },
      "TestProject",
      999,
    );
  });

  test("reuses the run id supplied in the constructor options", async () => {
    const configuredService = new AzureDevOpsService({
      orgUrl: "https://dev.azure.com/test-org",
      token: "fake-token",
      projectId: "TestProject",
      planId: 100,
      suiteId: 200,
      runId: 777,
    });

    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1001" }, configuration: { id: "1" } },
    ]);
    mockTestApi.addTestResultsToTestRun.mockResolvedValue([{ id: 1 }]);
    mockTestApi.getTestResults
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: 1, testCase: { id: "1001" } }]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
    ]);

    const runId = await configuredService.publishResults([
      { testCaseId: 1001, outcome: "Passed" },
    ]);

    expect(runId).toBe(777);
    expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
    expect(mockTestApi.updateTestRun).toHaveBeenCalledWith(
      { state: "Completed" },
      "TestProject",
      777,
    );
  });

  test("keepRunOpen leaves a newly created run in progress", async () => {
    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1001" }, configuration: { id: "1" } },
    ]);
    mockTestApi.createTestRun.mockResolvedValue({ id: 999 });
    mockTestApi.getTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
    ]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
    ]);

    await service.publishResults([{ testCaseId: 1001, outcome: "Passed" }], {
      keepRunOpen: true,
    });

    expect(mockTestApi.createTestRun).toHaveBeenCalledTimes(1);
    expect(mockTestApi.updateTestRun).not.toHaveBeenCalled();
    expect(service.runId).toBe(999);

    await service.completeRun();

    expect(mockTestApi.updateTestRun).toHaveBeenCalledWith(
      { state: "Completed" },
      "TestProject",
      999,
    );
    expect(service.runId).toBeUndefined();
  });

  test("only updates results belonging to the published batch", async () => {
    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1001" }, configuration: { id: "1" } },
      { id: 11, testCase: { id: "1002" }, configuration: { id: "1" } },
    ]);
    mockTestApi.addTestResultsToTestRun.mockResolvedValue([{ id: 2 }]);
    // The reused run already holds a result for a case from an earlier batch.
    mockTestApi.getTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
      { id: 2, testCase: { id: "1002" } },
    ]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 2, testCase: { id: "1002" } },
    ]);

    await service.publishResults([{ testCaseId: 1002, outcome: "Failed" }], {
      runId: 555,
    });

    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 2, outcome: "Failed" })],
      "TestProject",
      555,
    );
  });

  test("completeRun does nothing when no run has been used", async () => {
    await service.completeRun();

    expect(mockTestApi.updateTestRun).not.toHaveBeenCalled();
  });

  test("reuses pre-fetched points instead of calling getPoints again", async () => {
    mockTestApi.createTestRun.mockResolvedValue({ id: 999 });
    mockTestApi.getTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
    ]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1001" } },
    ]);

    const runId = await service.publishResults(
      [{ testCaseId: 1001, outcome: "Passed" }],
      {
        points: [
          { id: 10, testCase: { id: "1001" }, configuration: { id: "1" } },
        ] as any,
      },
    );

    expect(runId).toBe(999);
    expect(mockTestApi.getPoints).not.toHaveBeenCalled();
    expect(mockTestApi.createTestRun).toHaveBeenCalledWith(
      expect.objectContaining({ pointIds: [10], configurationIds: [1] }),
      "TestProject",
    );
  });

  test("should skip creating test run if no test points match", async () => {
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockTestApi.getPoints.mockResolvedValue([]);

    await service.publishResults([
      {
        testCaseId: 9999,
        outcome: "Passed",
      },
    ]);

    expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "No matching test points found in Azure DevOps for the given test cases.",
    );

    consoleSpy.mockRestore();
  });

  test("publishing results for one configuration does not overwrite another configuration's result for the same case", async () => {
    // Same test case (1001) is configured for both Android (config 1) and iOS (config 2).
    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1001" }, configuration: { id: "1" } },
      { id: 11, testCase: { id: "1001" }, configuration: { id: "2" } },
    ]);
    // The shared run already holds results for both configurations.
    mockTestApi.getTestResults.mockResolvedValue([
      {
        id: 1,
        testCase: { id: "1001" },
        configuration: { id: "1" },
        outcome: "Passed",
      },
      {
        id: 2,
        testCase: { id: "1001" },
        configuration: { id: "2" },
        outcome: "Passed",
      },
    ]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 2, testCase: { id: "1001" }, configuration: { id: "2" } },
    ]);

    // Only publish a failing iOS (configuration 2) result.
    await service.publishResults(
      [{ testCaseId: 1001, outcome: "Failed", configurationId: 2 }],
      { runId: 555 },
    );

    // Only the iOS result (id 2) should be updated; the Android result (id 1) is untouched.
    expect(mockTestApi.updateTestResults).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 2, outcome: "Failed" })],
      "TestProject",
      555,
    );
  });

  describe("when no PAT is configured", () => {
    let noTokenService: AzureDevOpsService;
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      jest.mocked(azdev.WebApi).mockClear();
      noTokenService = new AzureDevOpsService({
        orgUrl: "https://dev.azure.com/test-org",
        token: "",
        projectId: "TestProject",
        planId: 100,
        suiteId: 200,
      });
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    test("logs a warning instead of connecting to Azure DevOps", () => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Azure DevOps PAT (token) not provided; Azure DevOps test result publishing is disabled.",
      );
      expect(azdev.WebApi).not.toHaveBeenCalled();
    });

    test("createRun is a no-op", async () => {
      const runId = await noTokenService.createRun();

      expect(runId).toBeUndefined();
      expect(mockTestApi.getPoints).not.toHaveBeenCalled();
    });

    test("publishResults is a no-op", async () => {
      const runId = await noTokenService.publishResults([
        { testCaseId: 1234, outcome: "Passed" },
      ]);

      expect(runId).toBeUndefined();
      expect(mockTestApi.getPoints).not.toHaveBeenCalled();
      expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
    });

    test("completeRun is a no-op", async () => {
      await noTokenService.completeRun(999);

      expect(mockTestApi.updateTestRun).not.toHaveBeenCalled();
    });
  });
});
