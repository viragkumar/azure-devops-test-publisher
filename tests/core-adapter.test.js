const ADOTestAdapter = require("../lib/core-adapter");
const nock = require("nock");

describe("ADOTestAdapter", () => {
  const orgUrl = "https://dev.azure.com/fakeorg";
  const project = "fakeproject";
  let adapter;

  beforeEach(() => {
    nock.cleanAll();

    // 1. Intercept OPTIONS preflight request
    nock(orgUrl).persist().options("/_apis/Location").reply(200, {});

    // 2. Intercept GET location discovery request with required Test API metadata
    nock(orgUrl)
      .persist()
      .get("/_apis/Location")
      .query(true)
      .reply(200, {
        value: [
          {
            id: "12f4ce89-d2db-470a-a704-5555c486a4e3",
            locationUrl: `${orgUrl}/${project}/_apis/test`,
            locationVersion: "1",
            releasedVersion: "1",
          },
        ],
      });

    adapter = new ADOTestAdapter({
      pat: "fakepat123",
      orgUrl,
      project,
      planId: 101,
      suiteId: 202,
    });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  test("startRun successfully initializes an ADO test run with planId and suiteId", async () => {
    // Inject a mocked API client to bypass location lookup completely
    adapter.testApi = {
      createTestRun: jest
        .fn()
        .mockResolvedValue({ id: 999, name: "Sample Test Run" }),
    };

    const runId = await adapter.startRun("Sample Test Run");
    expect(runId).toBe(999);
    expect(adapter.activeRunId).toBe(999);
    expect(adapter.testApi.createTestRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sample Test Run",
        plan: { id: 101 },
        suite: { id: 202 },
      }),
      project,
    );
  });

  test("publish sends formatted test results to ADO", async () => {
    adapter.activeRunId = 999;
    adapter.testApi = {
      addTestResultsToTestRun: jest.fn().mockResolvedValue([{ id: 1001 }]),
      createTestResultAttachment: jest.fn().mockResolvedValue({}),
    };

    const results = [
      {
        title: "User Login",
        identifier: "Auth Module - User Login",
        passed: true,
        duration: 1500,
      },
    ];

    await adapter.publish(results);

    expect(adapter.testApi.addTestResultsToTestRun).toHaveBeenCalledWith(
      [
        {
          testCaseTitle: "User Login",
          automatedTestName: "Auth Module - User Login",
          outcome: "Passed",
          errorMessage: undefined,
          durationInMs: 1500,
          state: "Completed",
        },
      ],
      project,
      999,
    );
  });

  test("publish attaches screenshot when screenshotBase64 is present", async () => {
    adapter.activeRunId = 999;
    adapter.testApi = {
      addTestResultsToTestRun: jest.fn().mockResolvedValue([{ id: 1001 }]),
      createTestResultAttachment: jest.fn().mockResolvedValue({}),
    };

    const results = [
      {
        title: "Failed Checkout",
        identifier: "Payment - Failed Checkout",
        passed: false,
        error: "Element not found",
        duration: 2000,
        screenshotBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    ];

    await adapter.publish(results);

    expect(adapter.testApi.createTestResultAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentType: "GeneralAttachment",
        fileName: "failure-Failed_Checkout.png",
        stream: expect.any(String),
      }),
      project,
      999,
      1001,
    );
  });

  test("finishRun completes active test run", async () => {
    adapter.activeRunId = 999;
    adapter.testApi = {
      updateTestRun: jest.fn().mockResolvedValue({}),
    };

    await adapter.finishRun();

    expect(adapter.testApi.updateTestRun).toHaveBeenCalledWith(
      { state: "Completed" },
      project,
      999,
    );
    expect(adapter.activeRunId).toBeNull();
  });
});
