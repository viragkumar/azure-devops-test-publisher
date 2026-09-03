import { AzureDevOpsService } from './azureService';
import { AzureDevOpsOptions, TestAttachment, TestResultItem } from './types';

export class AzureDevOpsReporterService {
  private options: AzureDevOpsOptions;
  private results: TestResultItem[] = [];

  constructor(options: AzureDevOpsOptions) {
    this.options = options;
  }

  async afterTest(
    test: { title: string; duration: number },
    _context: unknown,
    results: { passed: boolean; error?: Error },
    browserInstance?: { takeScreenshot: () => Promise<string> }
  ): Promise<void> {
    const caseId = this.extractTestCaseId(test.title);
    if (!caseId) return;

    const attachments: TestAttachment[] = [];

    if (!results.passed && browserInstance) {
      try {
        const base64Png = await browserInstance.takeScreenshot();
        attachments.push({
          fileName: `failure-C${caseId}.png`,
          base64Content: base64Png,
          comment: `Failure screenshot for test: ${test.title}`
        });
      } catch (err) {
        console.error('Failed to capture browser screenshot:', err);
      }
    }

    this.results.push({
      testCaseId: caseId,
      outcome: results.passed ? 'Passed' : 'Failed',
      errorMessage: results.error?.message,
      durationInMs: test.duration,
      attachments
    });
  }

  async onComplete(): Promise<void> {
    if (this.results.length === 0) return;

    const ado = new AzureDevOpsService(this.options);
    await ado.publishResults(this.results);
  }

  private extractTestCaseId(title: string): number | null {
    const match = title.match(/C(\d+)/i) || title.match(/#(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }
}

export * from './types';
export * from './azureService';
