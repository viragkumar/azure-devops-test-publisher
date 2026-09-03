export interface AzureDevOpsOptions {
  orgUrl: string;
  token: string;
  projectName: string;
  planId: number;
  suiteId: number;
  runName?: string;
  caseIdMapping?: Record<string, number>;
}

export interface TestAttachment {
  fileName: string;
  base64Content: string;
  comment?: string;
  attachmentType?: string;
}

export interface TestResultItem {
  testCaseId: number;
  outcome: 'Passed' | 'Failed' | 'Inconclusive';
  errorMessage?: string;
  durationInMs?: number;
  attachments?: TestAttachment[];
}
