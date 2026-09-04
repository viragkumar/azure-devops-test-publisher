import { AzureDevOpsService } from "./azureService";
import {
  AzureDevOpsWdioOptions,
  TestAttachment,
  TestResultItem,
} from "./types";
import { extractTestCaseId } from "./utils";

export class AzureDevOpsReporterService {
  private options: AzureDevOpsWdioOptions;
  private results: TestResultItem[] = [];
  private ado?: AzureDevOpsService;

  constructor(options: AzureDevOpsWdioOptions) {
    this.options = options;
  }

  async afterTest(
    test: { title: string; duration: number },
    _context: unknown,
    results: { passed: boolean; error?: Error },
    browserInstance?: { takeScreenshot: () => Promise<string> },
  ): Promise<void> {
    const caseId = this.extractTestCaseId(test.title);
    if (!caseId) return;

    const attachments: TestAttachment[] = [];

    if (
      !results.passed &&
      browserInstance &&
      this.options.screenshotOnFailure !== false
    ) {
      try {
        const base64Png = await browserInstance.takeScreenshot();
        attachments.push({
          fileName: `failure-C${caseId}.png`,
          base64Content: base64Png,
          comment: `Failure screenshot for test: ${test.title}`,
        });
      } catch (err) {
        console.error("Failed to capture browser screenshot:", err);
      }
    }

    this.results.push({
      testCaseId: caseId,
      outcome: results.passed ? "Passed" : "Failed",
      errorMessage: results.error?.message,
      durationInMs: test.duration,
      attachments,
    });
  }

  async onComplete(): Promise<void> {
    if (this.results.length === 0) return;

    this.ado ??= new AzureDevOpsService(this.options);
    await this.ado.publishResults(this.results);
    this.results = [];
  }

  /** Completes the shared test run when `reuseTestRun` keeps it open. */
  async completeRun(): Promise<void> {
    await this.ado?.completeRun();
  }

  private extractTestCaseId(title: string): number | null {
    return extractTestCaseId(title, this.options.caseIdPattern);
  }
}

export * from "./types";
export * from "./azureService";
export * from "./wdioService";
