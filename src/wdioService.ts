import { AzureDevOpsService } from "./azureService";
import { AzureDevOpsWdioOptions, TestAttachment, TestResultItem } from "./types";
import { extractTestCaseId } from "./utils";

/** Shares the run id created in the launcher process with the worker processes. */
export const RUN_ID_ENV_VAR = "AZURE_DEVOPS_TEST_RUN_ID";

interface WdioTest {
  title: string;
  fullTitle?: string;
}

interface WdioTestResult {
  passed: boolean;
  duration?: number;
  error?: Error;
}

interface ScreenshotCapableBrowser {
  takeScreenshot: () => Promise<string>;
}

/**
 * WebdriverIO service that creates a single Test Run in `onPrepare`, pushes every
 * spec's results into that run, and completes it in `onComplete`.
 */
export class AzureDevOpsWdioService {
  private options: AzureDevOpsWdioOptions;
  private results: TestResultItem[] = [];
  private service?: AzureDevOpsService;

  constructor(options: AzureDevOpsWdioOptions) {
    this.options = options;
  }

  // --- launcher process hooks ---

  async onPrepare(): Promise<void> {
    const runId = await this.getService().createRun();
    process.env[RUN_ID_ENV_VAR] = runId.toString();
    console.log(`Azure DevOps test run created: ${runId}`);
  }

  async onComplete(): Promise<void> {
    const runId = this.resolveRunId();
    if (!runId) return;

    await this.getService().completeRun(runId);
    delete process.env[RUN_ID_ENV_VAR];
    console.log(`Azure DevOps test run completed: ${runId}`);
  }

  // --- worker process hooks ---

  async afterTest(
    test: WdioTest,
    _context: unknown,
    results: WdioTestResult,
  ): Promise<void> {
    const caseId = extractTestCaseId(test.title);
    if (!caseId) return;

    this.results.push({
      testCaseId: caseId,
      outcome: results.passed ? "Passed" : "Failed",
      errorMessage: results.error?.message,
      durationInMs: results.duration ?? 0,
      attachments: await this.captureScreenshot(caseId, test, results),
    });
  }

  async after(): Promise<void> {
    await this.publish();
  }

  /** Publishes everything collected so far into the shared run. */
  async publish(): Promise<void> {
    if (this.results.length === 0) return;

    const pending = this.results;
    this.results = [];

    try {
      await this.getService().publishResults(pending, {
        runId: this.resolveRunId(),
        keepRunOpen: true,
      });
    } catch (err) {
      console.error("Failed to publish results to Azure DevOps:", err);
    }
  }

  private async captureScreenshot(
    caseId: number,
    test: WdioTest,
    results: WdioTestResult,
  ): Promise<TestAttachment[]> {
    if (results.passed || this.options.screenshotOnFailure === false) return [];

    const browser = (globalThis as { browser?: ScreenshotCapableBrowser })
      .browser;
    if (!browser?.takeScreenshot) return [];

    try {
      return [
        {
          fileName: `failure-C${caseId}.png`,
          base64Content: await browser.takeScreenshot(),
          comment: `Failure screenshot for test: ${test.fullTitle || test.title}`,
        },
      ];
    } catch (err) {
      console.error("Failed to capture browser screenshot:", err);
      return [];
    }
  }

  private resolveRunId(): number | undefined {
    const fromEnv = process.env[RUN_ID_ENV_VAR];
    const parsed = fromEnv ? parseInt(fromEnv, 10) : NaN;
    return Number.isNaN(parsed) ? this.options.runId : parsed;
  }

  private getService(): AzureDevOpsService {
    this.service ??= new AzureDevOpsService(this.options);
    return this.service;
  }
}

/** WebdriverIO looks for a `launcher` export to run `onPrepare`/`onComplete`. */
export const launcher = AzureDevOpsWdioService;
export default AzureDevOpsWdioService;
