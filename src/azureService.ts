import * as azdev from "azure-devops-node-api";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { IdentityRef } from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import {
  TestCaseResult,
  TestAttachmentRequestModel,
} from "azure-devops-node-api/interfaces/TestInterfaces";
import { AzureDevOpsOptions, PublishOptions, TestResultItem } from "./types";

/** True if `point`/`result` belongs to the same test case as `item`, and the same configuration when `item.configurationId` is set. */
function matchesTestCase(
  point: { testCase?: { id?: string }; configuration?: { id?: string } },
  item: TestResultItem,
): boolean {
  if (
    !point.testCase?.id ||
    parseInt(point.testCase.id, 10) !== item.testCaseId
  ) {
    return false;
  }
  if (item.configurationId == null) return true;

  const pointConfigId = point.configuration?.id
    ? parseInt(point.configuration.id, 10)
    : undefined;
  return pointConfigId === item.configurationId;
}

/** Thrown when mandatory Azure DevOps options are missing or malformed. */
export class AzureDevOpsConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing or invalid Azure DevOps option(s): ${missing.join(", ")}. ` +
        "Provide them when constructing the service or in the wdio service options.",
    );
    this.name = "AzureDevOpsConfigError";
  }
}

export function assertRequiredOptions(config: AzureDevOpsOptions): void {
  const missing: string[] = [];

  if (!config?.orgUrl?.trim()) missing.push("orgUrl");
  if (!config?.projectId?.toString().trim()) missing.push("projectId");
  if (!Number.isInteger(config?.planId)) missing.push("planId");
  if (!Number.isInteger(config?.suiteId)) missing.push("suiteId");

  if (missing.length > 0) throw new AzureDevOpsConfigError(missing);
}

export class AzureDevOpsService {
  private testApiPromise?: Promise<ITestApi>;
  private connection?: azdev.WebApi;
  private runByPromise?: Promise<IdentityRef | undefined>;
  private config: AzureDevOpsOptions;
  private currentRunId?: number;
  /** Whether a PAT was provided; when false, every public method is a no-op. */
  private readonly enabled: boolean;

  constructor(config: AzureDevOpsOptions) {
    assertRequiredOptions(config);
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
    this.connection = connection;
    this.testApiPromise = connection.getTestApi();
  }

  /** Id of the run currently being published to, if any. */
  get runId(): number | undefined {
    return this.currentRunId;
  }

  /** PAT owner, surfaced as "Run by" on the result; Azure leaves the field blank otherwise. */
  private async getRunBy(): Promise<IdentityRef | undefined> {
    try {
      this.runByPromise ??= this.connection!.connect().then(
        (data) =>
          data.authenticatedUser && {
            id: data.authenticatedUser.id,
            displayName:
              data.authenticatedUser.customDisplayName ||
              data.authenticatedUser.providerDisplayName,
          },
      );
      return await this.runByPromise;
    } catch (err) {
      this.debug("Failed to resolve the Run by identity:", err);
      return undefined;
    }
  }

  private debug(message: string, payload?: unknown): void {
    if (!this.config.debug) return;
    console.log(message, payload);
  }

  /** Human readable target used in warnings and errors. */
  private describeTarget(configurationId?: number): string {
    const parts = [
      `project "${this.config.projectId}"`,
      `plan ${this.config.planId}`,
      `suite ${this.config.suiteId}`,
    ];
    if (configurationId != null) parts.push(`configuration ${configurationId}`);
    return parts.join(", ");
  }

  /** Creates an empty run; points are added by `publishResults` as tests finish, so unexecuted cases are never marked in progress. */
  async createRun(): Promise<number | undefined> {
    if (!this.enabled) return undefined;
    const testApi = await this.testApiPromise!;

    const testRun = await testApi.createTestRun(
      {
        name:
          this.config.runName ||
          `Automated Test Run - ${new Date().toISOString()}`,
        automated: true,
        plan: { id: this.config.planId.toString() },
        configurationIds: [],
      },
      this.config.projectId,
    );

    if (!testRun.id) {
      throw new Error(
        `Failed to create Test Run in Azure DevOps for ${this.describeTarget()}; the API returned a run without an id.`,
      );
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
    this.debug("Fetched test points:", points.length);

    const inTargetConfiguration = (item: {
      configuration?: { id?: string };
    }): boolean =>
      options.configurationId == null ||
      (item.configuration?.id != null &&
        parseInt(item.configuration.id, 10) === options.configurationId);

    const targetCaseIds = new Set(results.map((r) => r.testCaseId));
    const matchedPoints = points.filter(
      (p) =>
        p.testCase?.id &&
        targetCaseIds.has(parseInt(p.testCase.id, 10)) &&
        inTargetConfiguration(p) &&
        results.some((r) => matchesTestCase(p, r)),
    );
    this.debug("Matched test points:", matchedPoints);

    const matchedCaseIds = new Set(
      matchedPoints.map((p) => parseInt(p.testCase!.id!, 10)),
    );
    const unmatchedCaseIds = [...targetCaseIds].filter(
      (id) => !matchedCaseIds.has(id),
    );

    if (unmatchedCaseIds.length > 0) {
      console.warn(
        `No test point found for test case id(s) ${unmatchedCaseIds.join(", ")} in ${this.describeTarget(options.configurationId)}. ` +
          `The suite exposes ${points.length} point(s) for case id(s) ${
            points
              .map((p) => p.testCase?.id)
              .filter(Boolean)
              .join(", ") || "none"
          }. ` +
          "Check that the case ids in your test titles belong to this plan/suite and configuration.",
      );
    }

    if (matchedPoints.length === 0) return;

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
      // Only add points that the run does not already hold a result for (per case+configuration pair)
      const existingResults = await testApi.getTestResults(
        this.config.projectId,
        runId,
      );
      const existingPointKeys = new Set(
        existingResults.map(
          (r) => `${r.testCase?.id}:${r.configuration?.id ?? ""}`,
        ),
      );
      const missingPoints = matchedPoints.filter(
        (p) =>
          !existingPointKeys.has(
            `${p.testCase?.id}:${p.configuration?.id ?? ""}`,
          ),
      );

      if (missingPoints.length > 0) {
        await testApi.addTestResultsToTestRun(
          // Planned results are rejected unless point id, case id, revision and title are all present.
          missingPoints.map((p) => ({
            testPoint: { id: p.id!.toString() },
            testCase: { id: p.testCase!.id },
            testCaseRevision: 1,
            testCaseTitle: p.testCase?.name || `Test case ${p.testCase!.id}`,
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
        throw new Error(
          `Failed to create Test Run in Azure DevOps for ${this.describeTarget(options.configurationId)} with point id(s) ${pointIds.join(", ")}.`,
        );
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
    const runBy = await this.getRunBy();
    const updatedResults: TestCaseResult[] = runResults
      .filter(
        (result) =>
          inTargetConfiguration(result) &&
          results.some((r) => matchesTestCase(result, r)),
      )
      .map((result) => {
        const match = results.find((r) => matchesTestCase(result, r));
        return {
          ...result,
          outcome: match ? match.outcome : "Inconclusive",
          errorMessage: match?.errorMessage || "",
          state: "Completed",
          durationInMs: match?.durationInMs || 0,
          runBy: result.runBy ?? runBy,
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

    // The real API doesn't always echo `testCase`/`configuration` back on the updated
    // results, so fall back to what we already know from step 4.
    const resultInfoById = new Map<
      number,
      { caseId?: string; configurationId?: string }
    >();
    for (const result of updatedResults) {
      if (result.id) {
        resultInfoById.set(result.id, {
          caseId: result.testCase?.id,
          configurationId: result.configuration?.id,
        });
      }
    }

    // 6. Upload Attachments
    for (const savedResult of savedResults) {
      if (!savedResult.id) continue;
      const info = resultInfoById.get(savedResult.id);
      const caseId = savedResult.testCase?.id ?? info?.caseId;
      if (!caseId) continue;
      const configurationId =
        savedResult.configuration?.id ?? info?.configurationId;

      const matchedLocalResult = results.find((r) =>
        matchesTestCase(
          {
            testCase: { id: caseId },
            configuration: configurationId
              ? { id: configurationId }
              : undefined,
          },
          r,
        ),
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
