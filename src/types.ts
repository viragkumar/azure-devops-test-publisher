export interface AzureDevOpsOptions {
  orgUrl: string;
  token: string;
  projectName: string;
  planId: number;
  suiteId: number;
  runName?: string;
  caseIdMapping?: Record<string, number>;
  /** Reuse this already existing test run instead of creating a new one. */
  runId?: number;
  /** Publish every batch into a single run, created on the first publish. */
  reuseTestRun?: boolean;
}

export interface PublishOptions {
  /** Publish into this existing run instead of creating a new one. */
  runId?: number;
  /** Leave the run in progress so more results can be added later. */
  keepRunOpen?: boolean;
}

export interface AzureDevOpsWdioOptions extends AzureDevOpsOptions {
  /** Attach a browser screenshot to failed results. Defaults to true. */
  screenshotOnFailure?: boolean;
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
}
