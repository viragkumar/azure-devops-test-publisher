import * as azdev from "azure-devops-node-api";
import { ITestApi } from "azure-devops-node-api/TestApi";
import {
  TestCaseResult,
  TestAttachmentRequestModel,
} from "azure-devops-node-api/interfaces/TestInterfaces";
import { AzureDevOpsOptions, PublishOptions, TestResultItem } from "./types";

export class AzureDevOpsService {
  private testApiPromise?: Promise<ITestApi>;
  private config: AzureDevOpsOptions;
  private currentRunId?: number;
  /** Whether a PAT was provided; when false, every public method is a no-op. */
  private readonly enabled: boolean;

  constructor(config: AzureDevOpsOptions) {
    this.config = config;
    this.currentRunId = config.runId;
    this.enabled = Boolean(config.token);

    if (!this.enabled) {
      console.warn(
        "Azure DevOps PAT (token) not provided; Azure DevOps test result publishing is disabled.",
      );
      return;
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(config.token);
    const connection = new azdev.WebApi(config.orgUrl, authHandler);
    this.testApiPromise = connection.getTestApi();
  }

  /** Id of the run currently being published to, if any. */
  get runId(): number | undefined {
    return this.currentRunId;
  }

  private debug(message: string, payload?: unknown): void {
    if (!this.config.debug) return;
    console.log(message, payload);
  }

  /** Creates an empty run covering every point of the configured suite. */
  async createRun(): Promise<number | undefined> {
    if (!this.enabled) return undefined;
    const testApi = await this.testApiPromise!;
    const points = await testApi.getPoints(
      this.config.projectId,
      this.config.planId,
      this.config.suiteId,
    );

    const pointIds = points
      .map((p) => p.id)
      .filter((id): id is number => typeof id === "number");
    const configurationIds = Array.from(
      new Set(
        points
          .map((p) =>
            p.configuration?.id ? parseInt(p.configuration.id, 10) : null,
          )
          .filter((id): id is number => id !== null),
      ),
    );

    const testRun = await testApi.createTestRun(
      {
        name:
          this.config.runName ||
          `Automated Test Run - ${new Date().toISOString()}`,
        automated: true,
        plan: { id: this.config.planId.toString() },
        pointIds,
        configurationIds,
      },
      this.config.projectId,
    );

    if (!testRun.id) {
      throw new Error("Failed to create Test Run in Azure DevOps.");
    }

    this.currentRunId = testRun.id;
    return testRun.id;
  }

  async publishResults(
    results: TestResultItem[],
    options: PublishOptions = {},
  ): Promise<number | undefined> {
    if (!this.enabled) return undefined;
    const testApi = await this.testApiPromise!;

    // 1. Get test points matching the local test cases
    const points =
      options.points ??
      (await testApi.getPoints(
        this.config.projectId,
        this.config.planId,
        this.config.suiteId,
      ));
    this.debug("Fetched test points:", points);

    const targetCaseIds = new Set(results.map((r) => r.testCaseId));
    const matchedPoints = points.filter(
      (p) => p.testCase?.id && targetCaseIds.has(parseInt(p.testCase.id, 10)),
    );
    this.debug("Matched test points:", matchedPoints);

    if (matchedPoints.length === 0) {
      console.warn(
        "No matching test points found in Azure DevOps for the given test cases.",
      );
      return;
    }

    const pointIds = matchedPoints.map((p) => p.id!);
    this.debug("Point IDs for the test run:", pointIds);

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
    this.debug("Configuration IDs for the test run:", configurationIds);

    // 2. Reuse the existing Test Run when asked, otherwise create a new one
    const reusedRunId =
      options.runId ??
      (this.config.reuseTestRun ? this.currentRunId : undefined) ??
      this.config.runId;
    let runId: number;

    if (reusedRunId) {
      runId = reusedRunId;
      // Only add points that the run does not already hold a result for
      const existingResults = await testApi.getTestResults(
        this.config.projectId,
        runId,
      );
      const existingCaseIds = new Set(
        existingResults.map((r) => r.testCase?.id),
      );
      const missingPoints = matchedPoints.filter(
        (p) => !existingCaseIds.has(p.testCase!.id),
      );

      if (missingPoints.length > 0) {
        await testApi.addTestResultsToTestRun(
          missingPoints.map((p) => ({
            testPoint: { id: p.id!.toString() },
            testCase: { id: p.testCase!.id },
            configuration: p.configuration?.id
              ? { id: p.configuration.id }
              : undefined,
          })),
          this.config.projectId,
          runId,
        );
      }
    } else {
      const runName =
        this.config.runName ||
        `Automated Test Run - ${new Date().toISOString()}`;
      const testRun = await testApi.createTestRun(
        {
          name: runName,
          automated: true,
          plan: { id: this.config.planId.toString() },
          pointIds: pointIds,
          configurationIds: configurationIds,
        },
        this.config.projectId,
      );

      if (!testRun.id) {
        throw new Error("Failed to create Test Run in Azure DevOps.");
      }
      runId = testRun.id;
    }

    this.currentRunId = runId;

    // 3. Fetch automatically created results for the run
    const runResults = await testApi.getTestResults(
      this.config.projectId,
      runId,
    );

    // 4. Map outcomes and error messages
    this.debug("Run results fetched from Azure DevOps:", runResults);
    const updatedResults: TestCaseResult[] = runResults
      .filter((result) =>
        results.some((r) => r.testCaseId.toString() === result.testCase?.id),
      )
      .map((result) => {
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
    this.debug("Updating test results in Azure DevOps:", updatedResults);
    const savedResults = await testApi.updateTestResults(
      updatedResults,
      this.config.projectId,
      runId,
    );
    this.debug("Saved test results:", savedResults);

    // The real API doesn't always echo `testCase` back on the updated results,
    // so fall back to the id->caseId mapping we already know from step 4.
    const caseIdByResultId = new Map<number, string>();
    for (const result of updatedResults) {
      if (result.id && result.testCase?.id) {
        caseIdByResultId.set(result.id, result.testCase.id);
      }
    }

    // 6. Upload Attachments
    for (const savedResult of savedResults) {
      if (!savedResult.id) continue;
      const caseId =
        savedResult.testCase?.id ?? caseIdByResultId.get(savedResult.id);
      if (!caseId) continue;

      const matchedLocalResult = results.find(
        (r) => r.testCaseId.toString() === caseId,
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

          // Log metadata only; the base64 stream is far too large to print.
          this.debug("Uploading attachment:", {
            resultId: savedResult.id,
            caseId,
            fileName: attachmentModel.fileName,
            attachmentType: attachmentModel.attachmentType,
            base64Length: attachment.base64Content?.length ?? 0,
          });

          const savedAttachment = await testApi.createTestResultAttachment(
            attachmentModel,
            this.config.projectId,
            runId,
            savedResult.id,
          );
          this.debug("Attachment uploaded:", savedAttachment);
        }
      } else {
        this.debug("No attachments to upload for case:", caseId);
      }
    }

    // 7. Complete the Test Run unless more results are still to come
    const keepRunOpen =
      options.keepRunOpen ?? this.config.reuseTestRun ?? false;
    if (!keepRunOpen) {
      await this.completeRun(runId);
    }

    return runId;
  }

  /** Marks a run as completed. Defaults to the run used by the last publish. */
  async completeRun(runId = this.currentRunId): Promise<void> {
    if (!this.enabled || !runId) return;
    const testApi = await this.testApiPromise!;
    await testApi.updateTestRun(
      { state: "Completed" },
      this.config.projectId,
      runId,
    );
    if (runId === this.currentRunId) {
      this.currentRunId = undefined;
    }
  }
}
