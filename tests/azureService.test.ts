import { AzureDevOpsService } from "../src/azureService";
import * as azdev from "azure-devops-node-api";

jest.mock("azure-devops-node-api");

describe("AzureDevOpsService", () => {
  let service: AzureDevOpsService;

  const mockTestApi = {
    getPoints: jest.fn(),
    createTestRun: jest.fn(),
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
      projectName: "TestProject",
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
});
