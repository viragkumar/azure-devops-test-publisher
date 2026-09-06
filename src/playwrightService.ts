import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { readFileSync } from "fs";
import { AzureDevOpsService, assertRequiredOptions } from "./azureService";
import {
  AzureDevOpsPlaywrightOptions,
  TestAttachment,
  TestResultItem,
} from "./types";
import { extractTestCaseId, RUN_ID_ENV_VAR } from "./utils";

/**
 * Playwright reporter that creates a single Test Run in `onBegin`, collects every
 * test's result via `onTestEnd`, and publishes + completes the run in `onEnd`.
 *
 * Unlike the WebdriverIO service, Playwright reporters run once in the main
 * process regardless of worker count, so no run id needs to be shared across
 * processes.
 */
export default class AzureDevOpsPlaywrightReporter implements Reporter {
  private results: TestResultItem[] = [];
  private service: AzureDevOpsService;
  private runId?: number;

  constructor(private readonly options: AzureDevOpsPlaywrightOptions) {
    assertRequiredOptions(options);
    this.service = new AzureDevOpsService(options);
  }

  private debug(message: string, payload?: unknown): void {
    if (!this.options.debug) return;
    console.log(message, payload);
  }

  async onBegin(): Promise<void> {
    const existingRunId = this.resolveExistingRunId();
    if (existingRunId) {
      this.runId = existingRunId;
      console.log(`Reusing Azure DevOps test run: ${existingRunId}`);
      return;
    }

    this.runId = await this.service.createRun();
    if (this.runId !== undefined) {
      console.log(`Azure DevOps test run created: ${this.runId}`);
    }
  }

  /** Checks the shared `AZURE_DEVOPS_TEST_RUN_ID` env var before the `runId` option; `0` and unset both mean "create a new run". */
  private resolveExistingRunId(): number | undefined {
    const fromEnv = process.env[RUN_ID_ENV_VAR];
    const parsed = fromEnv ? parseInt(fromEnv, 10) : NaN;
    const runId = Number.isNaN(parsed) ? this.options.runId : parsed;
    return runId || undefined;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const caseId = this.extractCaseId(test);
    if (!caseId) return;

    this.results.push({
      testCaseId: caseId,
      outcome: this.mapOutcome(result.status),
      errorMessage:
        result.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join("\n") || undefined,
      stackTrace:
        result.errors
          .map((e) => e.stack)
          .filter(Boolean)
          .join("\n\n") || undefined,
      durationInMs: result.duration,
      attachments: this.collectScreenshots(caseId, test, result),
      configurationId: this.options.configurationId,
    });
  }

  async onEnd(): Promise<void> {
    if (this.results.length > 0) {
      try {
        await this.service.publishResults(this.results, {
          runId: this.runId,
          configurationId: this.options.configurationId,
        });
      } catch (err) {
        console.error("Failed to publish results to Azure DevOps:", err);
      }
    }

    if (this.runId !== undefined) {
      await this.service.completeRun(this.runId);
      console.log(`Azure DevOps test run completed: ${this.runId}`);
    }
  }

  private mapOutcome(status: TestResult["status"]): TestResultItem["outcome"] {
    if (status === "passed") return "Passed";
    if (status === "skipped" || status === "interrupted") return "Inconclusive";
    return "Failed";
  }

  /**
   * Checks tags before falling back to the title/scenario name. Two tag sources are merged:
   * native Playwright tags (`test(title, { tag: [...] })`, exposed as `TestCase.tags`) and
   * playwright-bdd's Gherkin `@tags`, exposed as `annotations` of type `"tag"` instead.
   */
  private extractCaseId(test: TestCase): number | null {
    const pattern = this.options.caseIdPattern;
    const tags = [
      ...(test.tags ?? []),
      ...test.annotations
        .filter((a) => a.type === "tag")
        .map((a) => a.description ?? ""),
    ];

    const caseId = extractTestCaseId(test.title, pattern, tags);
    this.debug("Extracted case id from test title/tags:", {
      title: test.title,
      tags,
      pattern: String(pattern ?? "default C123/#123"),
      caseId,
    });
    return caseId;
  }

  /** Reuses screenshots Playwright itself captured (e.g. `screenshot: "only-on-failure"`); it does not take a new one. */
  private collectScreenshots(
    caseId: number,
    test: TestCase,
    result: TestResult,
  ): TestAttachment[] {
    if (
      result.status === "passed" ||
      this.options.screenshotOnFailure === false
    ) {
      return [];
    }

    const attachments: TestAttachment[] = [];
    for (const attachment of result.attachments) {
      if (!attachment.contentType.startsWith("image/")) continue;

      try {
        const base64Content = attachment.body
          ? attachment.body.toString("base64")
          : attachment.path
            ? readFileSync(attachment.path).toString("base64")
            : undefined;
        if (!base64Content) continue;

        attachments.push({
          fileName: `failure-C${caseId}-${attachment.name}.png`,
          base64Content,
          comment: `Failure screenshot for test: ${test.title}`,
        });
      } catch (err) {
        console.error("Failed to read Playwright screenshot attachment:", err);
      }
    }
    return attachments;
  }
}

export { AzureDevOpsPlaywrightReporter };
