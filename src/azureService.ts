import * as azdev from "azure-devops-node-api";
import { ITestApi } from "azure-devops-node-api/TestApi";
import {
  TestCaseResult,
  TestAttachmentRequestModel,
} from "azure-devops-node-api/interfaces/TestInterfaces";
import { AzureDevOpsOptions, TestResultItem } from "./types";

export class AzureDevOpsService {
  private testApiPromise: Promise<ITestApi>;
  private config: AzureDevOpsOptions;

  constructor(config: AzureDevOpsOptions) {
    this.config = config;
    const authHandler = azdev.getPersonalAccessTokenHandler(config.token);
    const connection = new azdev.WebApi(config.orgUrl, authHandler);
    this.testApiPromise = connection.getTestApi();
  }

  async publishResults(results: TestResultItem[]): Promise<void> {
    const testApi = await this.testApiPromise;

    // 1. Get test points matching the local test cases
    const points = await testApi.getPoints(
      this.config.projectName,
      this.config.planId,
      this.config.suiteId,
    );

    const targetCaseIds = new Set(results.map((r) => r.testCaseId));
    const matchedPoints = points.filter(
      (p) => p.testCase?.id && targetCaseIds.has(parseInt(p.testCase.id, 10)),
    );

    if (matchedPoints.length === 0) {
      console.warn(
        "No matching test points found in Azure DevOps for the given test cases.",
      );
      return;
    }

    const pointIds = matchedPoints.map((p) => p.id!);

    // Extract unique configuration IDs from matched points (or fallback to empty array/default)
    const configurationIds = Array.from(
      new Set(
        matchedPoints
          .map((p) =>
            p.configuration?.id ? parseInt(p.configuration.id, 10) : null,
          )
          .filter((id): id is number => id !== null),
      ),
    );

    // 2. Create the Test Run with configurationIds included
    const runName =
      this.config.runName || `Automated Test Run - ${new Date().toISOString()}`;
    const testRun = await testApi.createTestRun(
      {
        name: runName,
        automated: true,
        plan: { id: this.config.planId.toString() },
        pointIds: pointIds,
        configurationIds: configurationIds, // Fixes TS2345
      },
      this.config.projectName,
    );

    if (!testRun.id) {
      throw new Error("Failed to create Test Run in Azure DevOps.");
    }

    // 3. Fetch automatically created results for the run
    const runResults = await testApi.getTestResults(
      this.config.projectName,
      testRun.id,
    );

    // 4. Map outcomes and error messages
    const updatedResults: TestCaseResult[] = runResults.map((result) => {
      const match = results.find(
        (r) => r.testCaseId.toString() === result.testCase?.id,
      );

      return {
        ...result,
        outcome: match ? match.outcome : "Inconclusive",
        errorMessage: match?.errorMessage || "",
        state: "Completed",
        durationInMs: match?.durationInMs || 0,
      };
    });

    // 5. Update test results in ADO
    const savedResults = await testApi.updateTestResults(
      updatedResults,
      this.config.projectName,
      testRun.id,
    );

    // 6. Upload Attachments
    for (const savedResult of savedResults) {
      if (!savedResult.id || !savedResult.testCase?.id) continue;

      const matchedLocalResult = results.find(
        (r) => r.testCaseId.toString() === savedResult.testCase?.id,
      );

      if (
        matchedLocalResult?.attachments &&
        matchedLocalResult.attachments.length > 0
      ) {
        for (const attachment of matchedLocalResult.attachments) {
          const attachmentModel: TestAttachmentRequestModel = {
            fileName: attachment.fileName,
            stream: attachment.base64Content,
            comment: attachment.comment || "Automated execution screenshot",
            attachmentType: attachment.attachmentType || "GeneralAttachment",
          };

          await testApi.createTestResultAttachment(
            attachmentModel,
            this.config.projectName,
            testRun.id,
            savedResult.id,
          );
        }
      }
    }

    // 7. Complete the Test Run
    await testApi.updateTestRun(
      { state: "Completed" },
      this.config.projectName,
      testRun.id,
    );
  }
}
