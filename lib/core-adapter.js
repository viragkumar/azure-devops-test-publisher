const azdev = require("azure-devops-node-api");

class ADOTestAdapter {
  constructor(options) {
    this.token = options.personalAccessToken || options.pat;
    this.orgUrl = options.organizationUrl || options.orgUrl;
    this.project = options.project || options.projectName;
    this.planId = options.testPlanId || options.planId;
    this.suiteId = options.testSuiteId || options.suiteId; // Added Suite ID parameter
    this.activeRunId = null;
    this.testApi = null;
  }

  async connect() {
    if (this.testApi) return;
    const authHandler = azdev.getPersonalAccessTokenHandler(this.token);
    const api = new azdev.WebApi(this.orgUrl, authHandler);
    this.testApi = await api.getTestApi();
  }

  async startRun(title) {
    await this.connect();

    const runOptions = {
      name: title || `Test Run - ${new Date().toISOString()}`,
      automated: true,
      plan: { id: this.planId },
    };

    // Attach Suite ID to the run payload if provided
    if (this.suiteId) {
      runOptions.suite = { id: this.suiteId };
    }

    const run = await this.testApi.createTestRun(runOptions, this.project);
    this.activeRunId = run.id;
    return this.activeRunId;
  }

  async publish(results) {
    if (!this.activeRunId)
      throw new Error("[ado-test-adapter] No active Test Run found.");

    const payload = results.map((r) => ({
      testCaseTitle: r.title,
      automatedTestName: r.identifier || r.title,
      outcome: r.passed ? "Passed" : "Failed",
      errorMessage: r.error || undefined,
      durationInMs: r.duration || 0,
      state: "Completed",
    }));

    const uploaded = await this.testApi.addTestResultsToTestRun(
      payload,
      this.project,
      this.activeRunId,
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].screenshotBase64 && uploaded[i]?.id) {
        await this.attachScreenshot(
          uploaded[i].id,
          results[i].screenshotBase64,
          results[i].title,
        );
      }
    }
  }

  async attachScreenshot(resultId, base64Data, title) {
    const attachment = {
      attachmentType: "GeneralAttachment",
      comment: "Failure Attachment",
      fileName: `failure-${title.replace(/[^a-zA-Z0-9]/g, "_")}.png`,
      stream: base64Data,
    };
    await this.testApi.createTestResultAttachment(
      attachment,
      this.project,
      this.activeRunId,
      resultId,
    );
  }

  async finishRun() {
    if (!this.activeRunId) return;
    await this.testApi.updateTestRun(
      { state: "Completed" },
      this.project,
      this.activeRunId,
    );
    this.activeRunId = null;
  }
}

module.exports = ADOTestAdapter;
