import { AzureDevOpsReporterService } from "../../src/index";
import * as azdev from "azure-devops-node-api";

// Only mock the external Azure DevOps API boundary; exercise the real
// AzureDevOpsReporterService -> AzureDevOpsService flow end-to-end.
jest.mock("azure-devops-node-api");

describe("AzureDevOpsReporterService integration", () => {
  const mockTestApi = {
    getPoints: jest.fn(),
    createTestRun: jest.fn(),
    getTestResults: jest.fn(),
    updateTestResults: jest.fn(),
    createTestResultAttachment: jest.fn(),
    updateTestRun: jest.fn(),
  };

  const mockOptions = {
    orgUrl: "https://dev.azure.com/test-org",
    token: "fake-token",
    projectName: "TestProject",
    planId: 100,
    suiteId: 200,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(azdev.getPersonalAccessTokenHandler).mockReturnValue({} as any);
    jest.mocked(azdev.WebApi).mockImplementation(
      () =>
        ({
          getTestApi: jest.fn().mockResolvedValue(mockTestApi),
        }) as any,
    );
  });

  test("captures a failing test with screenshot and publishes it through to Azure DevOps", async () => {
    mockTestApi.getPoints.mockResolvedValue([
      { id: 10, testCase: { id: "1234" }, configuration: { id: "1" } },
    ]);
    mockTestApi.createTestRun.mockResolvedValue({ id: 999 });
    mockTestApi.getTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1234" } },
    ]);
    mockTestApi.updateTestResults.mockResolvedValue([
      { id: 1, testCase: { id: "1234" } },
    ]);

    const mockBrowser = {
      takeScreenshot: jest.fn().mockResolvedValue("base64ScreenshotData"),
    };

    const service = new AzureDevOpsReporterService(mockOptions);

    await service.afterTest(
      { title: "C1234 Login functionality test", duration: 500 },
      {},
      { passed: false, error: new Error("Element not found") },
      mockBrowser,
    );

    await service.onComplete();

    expect(mockTestApi.createTestRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pointIds: [10],
        configurationIds: [1],
      }),
      "TestProject",
    );

    expect(mockTestApi.createTestResultAttachment).toHaveBeenCalledWith(
      {
        fileName: "failure-C1234.png",
        stream: "base64ScreenshotData",
        comment: "Failure screenshot for test: C1234 Login functionality test",
        attachmentType: "GeneralAttachment",
      },
      "TestProject",
      999,
      1,
    );

    expect(mockTestApi.updateTestRun).toHaveBeenCalledWith(
      { state: "Completed" },
      "TestProject",
      999,
    );
  });

  test("does not contact Azure DevOps when no test titles contain a case ID", async () => {
    const service = new AzureDevOpsReporterService(mockOptions);

    await service.afterTest(
      { title: "Untagged test with no case id", duration: 100 },
      {},
      { passed: true },
    );

    await service.onComplete();

    expect(mockTestApi.createTestRun).not.toHaveBeenCalled();
  });
});
