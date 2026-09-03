import { AzureDevOpsReporterService } from "../src/index";
import { AzureDevOpsService } from "../src/azureService";

jest.mock("../src/azureService");

describe("AzureDevOpsReporterService", () => {
  let service: AzureDevOpsReporterService;
  const mockOptions = {
    orgUrl: "https://dev.azure.com/test-org",
    token: "fake-token",
    projectName: "TestProject",
    planId: 101,
    suiteId: 202,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AzureDevOpsReporterService(mockOptions);
  });

  test('should parse case IDs from test titles with format "C1234"', async () => {
    await service.afterTest(
      { title: "C1234 Login functionality test", duration: 120 },
      {},
      { passed: true },
    );

    const results = (service as any).results;
    expect(results).toHaveLength(1);
    expect(results[0].testCaseId).toBe(1234);
    expect(results[0].outcome).toBe("Passed");
  });

  test("should capture base64 screenshot when test fails", async () => {
    const mockBrowser = {
      takeScreenshot: jest.fn().mockResolvedValue("base64StringData"),
    };

    await service.afterTest(
      { title: "#5678 Dashboard load error", duration: 300 },
      {},
      { passed: false, error: new Error("Element not found") },
      mockBrowser,
    );

    const results = (service as any).results;
    expect(results[0].outcome).toBe("Failed");
    expect(results[0].attachments).toHaveLength(1);
    expect(results[0].attachments[0]).toEqual({
      fileName: "failure-C5678.png",
      base64Content: "base64StringData",
      comment: "Failure screenshot for test: #5678 Dashboard load error",
    });
  });

  test("should skip uploading if no results were collected", async () => {
    await service.onComplete();
    expect(AzureDevOpsService.prototype.publishResults).not.toHaveBeenCalled();
  });
});
