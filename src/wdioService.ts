import type { Frameworks, Services } from "@wdio/types" with {
  "resolution-mode": "import",
};
import { AzureDevOpsService } from "./azureService";
import {
  AzureDevOpsWdioOptions,
  TestAttachment,
  TestResultItem,
} from "./types";
import { extractTestCaseId } from "./utils";

/** Shares the run id created in the launcher process with the worker processes. */
export const RUN_ID_ENV_VAR = "AZURE_DEVOPS_TEST_RUN_ID";

interface ScreenshotCapableBrowser {
  takeScreenshot: () => Promise<string>;
}

interface CucumberPickleTag {
  name: string;
}

/** Shape of the `world` argument WebdriverIO's Cucumber framework passes to `afterScenario`. */
interface CucumberWorld {
  pickle: {
    name: string;
    tags?: CucumberPickleTag[];
  };
}

/**
 * WebdriverIO service that creates a single Test Run in `onPrepare`, pushes every
 * spec's results into that run, and completes it in `onComplete`.
 */
export default class AzureDevOpsWdioService
  implements Services.ServiceInstance
{
  private results: TestResultItem[] = [];
  private service?: AzureDevOpsService;

  constructor(private readonly _options: AzureDevOpsWdioOptions) {}

  // --- launcher process hooks ---

  async onPrepare(): Promise<void> {
    const runId = await this.getService().createRun();
    if (runId === undefined) return;

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

  private debug(message: string, payload?: unknown): void {
    if (!this._options.debug) return;
    console.log(message, payload);
  }

  async afterTest(
    test: Frameworks.Test,
    _context: unknown,
    results: Frameworks.TestResult,
  ): Promise<void> {
    const caseId = extractTestCaseId(test.title, this._options.caseIdPattern);
    this.debug("Extracted case id from test title:", {
      title: test.title,
      pattern: String(this._options.caseIdPattern ?? "default C123/#123"),
      caseId,
    });
    if (!caseId) return;

    this.results.push({
      testCaseId: caseId,
      outcome: results.passed ? "Passed" : "Failed",
      errorMessage: results.error?.message,
      durationInMs: results.duration ?? 0,
      attachments: await this.captureScreenshot(caseId, test, results),
      configurationId: this._options.configurationId,
    });
  }

  /** Cucumber hook for BDD feature files; reads the case id from a `@C123` tag or the scenario name. */
  async afterScenario(
    world: CucumberWorld,
    result: Frameworks.PickleResult,
  ): Promise<void> {
    const caseId = this.extractCucumberCaseId(world);
    if (!caseId) return;

    this.results.push({
      testCaseId: caseId,
      outcome: result.passed ? "Passed" : "Failed",
      errorMessage: this.stringifyError(result.error),
      durationInMs: result.duration ?? 0,
      attachments: await this.captureScreenshot(
        caseId,
        { title: world.pickle.name },
        result,
      ),
      configurationId: this._options.configurationId,
    });
  }

  /** Cucumber's `error` is typed as a string, but some frameworks still pass a raw `Error`. */
  private stringifyError(error: unknown): string | undefined {
    if (!error) return undefined;
    return error instanceof Error ? error.message : String(error);
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
    test: Frameworks.Test | { title: string; fullTitle?: string },
    results: Frameworks.TestResult | Frameworks.PickleResult,
  ): Promise<TestAttachment[]> {
    if (results.passed || this._options.screenshotOnFailure === false)
      return [];

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

  private extractCucumberCaseId(world: CucumberWorld): number | null {
    const pattern = this._options.caseIdPattern;
    const tags = world.pickle.tags ?? [];
    this.debug("Scanning scenario tags for case id:", {
      scenario: world.pickle.name,
      tags: tags.map((t) => t.name),
      pattern: String(pattern ?? "default C123/#123"),
    });

    for (const tag of tags) {
      const caseId = extractTestCaseId(tag.name, pattern);
      if (caseId) {
        this.debug("Matched case id from tag:", { tag: tag.name, caseId });
        return caseId;
      }
    }

    const fromName = extractTestCaseId(world.pickle.name, pattern);
    this.debug("No tag matched; fell back to scenario name:", {
      scenario: world.pickle.name,
      caseId: fromName,
    });
    return fromName;
  }

  private resolveRunId(): number | undefined {
    const fromEnv = process.env[RUN_ID_ENV_VAR];
    const parsed = fromEnv ? parseInt(fromEnv, 10) : NaN;
    return Number.isNaN(parsed) ? this._options.runId : parsed;
  }

  private getService(): AzureDevOpsService {
    this.service ??= new AzureDevOpsService(this._options);
    return this.service;
  }
}

export { AzureDevOpsWdioService };
