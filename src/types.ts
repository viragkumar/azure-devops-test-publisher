import { TestPoint } from "azure-devops-node-api/interfaces/TestInterfaces";

export interface AzureDevOpsOptions {
  orgUrl: string;
  token: string;
  /** Project display name or its GUID; Azure DevOps accepts either. */
  projectId: string;
  planId: number;
  suiteId: number;
  runName?: string;
  /** Reuse this already existing test run instead of creating a new one. */
  runId?: number;
  /** Publish every batch into a single run, created on the first publish. */
  reuseTestRun?: boolean;
  /** Custom regex (with a capturing group for the numeric id) used instead of the default `C123`/`#123` matcher. */
  caseIdPattern?: RegExp;
  /** Log Azure DevOps API payloads to the console. Off by default. */
  debug?: boolean;
}

export interface PublishOptions {
  /** Publish into this existing run instead of creating a new one. */
  runId?: number;
  /** Reuse already-fetched test points instead of calling `getPoints` again. */
  points?: TestPoint[];
  /** Only publish to the test point/result of this Azure DevOps configuration id; others are left untouched. */
  configurationId?: number;
  /** Leave the run in progress so more results can be added later. */
  keepRunOpen?: boolean;
}

export interface AzureDevOpsWdioOptions extends AzureDevOpsOptions {
  /** Attach a browser screenshot to failed results. Defaults to true. */
  screenshotOnFailure?: boolean;
  /** Azure DevOps test configuration id (e.g. Android vs iOS) this worker's results belong to. Required when the same test case is configured for multiple configurations, otherwise results can bleed across configurations. */
  configurationId?: number;
}

/** Same shape as `AzureDevOpsWdioOptions`, kept separate so the WebdriverIO and Playwright integrations can diverge independently. */
export interface AzureDevOpsPlaywrightOptions extends AzureDevOpsOptions {
  /** Attach Playwright's screenshot attachment to failed results. Defaults to true; requires Playwright's own `screenshot` option to actually capture one. */
  screenshotOnFailure?: boolean;
  /** Azure DevOps test configuration id (e.g. Chromium vs WebKit) results from this reporter belong to. Required when the same test case is configured for multiple configurations, otherwise results can bleed across configurations. */
  configurationId?: number;
}

export interface TestAttachment {
  fileName: string;
  base64Content: string;
  comment?: string;
  attachmentType?: string;
}

export interface TestResultItem {
  testCaseId: number;
  outcome: "Passed" | "Failed" | "Inconclusive";
  errorMessage?: string;
  durationInMs?: number;
  attachments?: TestAttachment[];
  /** Azure DevOps test configuration id; disambiguates test points/results that share a case id across configurations (e.g. Android vs iOS). */
  configurationId?: number;
}
