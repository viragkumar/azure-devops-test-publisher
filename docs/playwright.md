# Playwright guide

Publishing `@playwright/test` results to Azure DevOps Test Plans with `AzureDevOpsPlaywrightReporter`.

← Back to the [main README](../README.md) · Using WebdriverIO instead? See the [WebdriverIO guide](webdriverio.md).

## Contents

- [Setup](#setup)
- [Test titles](#test-titles)
- [Native Playwright tags](#native-playwright-tags)
- [playwright-bdd feature files](#playwright-bdd-feature-files)
- [Custom case id pattern](#custom-case-id-pattern)
- [Per-test suite ids (`suiteIdPattern`)](#per-test-suite-ids-suiteidpattern)
- [Sample feature file](#sample-feature-file-caseidpattern--suiteidpattern)
- [Screenshots](#screenshots)
- [Test configurations](#test-configurations-chromium-vs-webkit-)
- [Reusing an existing Test Run](#reusing-an-existing-test-run)
- [Options and validation](#options-and-validation)
- [Troubleshooting unmatched test cases](#troubleshooting-unmatched-test-cases)

## Setup

Register `AzureDevOpsPlaywrightReporter` as a reporter in `playwright.config.ts`, importing it from the `/playwright` subpath:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: {
    screenshot: "only-on-failure", // required for failure screenshots to be attached
  },
  reporter: [
    ["list"],
    [
      "@virag8/azure-devops-test-publisher/playwright",
      {
        orgUrl: process.env.AZURE_ORG_URL,
        token: process.env.AZURE_PAT,
        projectId: "MyProject", // name or GUID
        planId: 123,
        suiteId: 456,
        screenshotOnFailure: true, // optional, defaults to true
      },
    ],
  ],
});
```

Requires `@playwright/test` as a peer dependency (already present if you're using Playwright's test runner).

Unlike the WebdriverIO service, Playwright reporters run in a single main process regardless of how many workers execute tests, so there's no run id to share across processes — the reporter creates the run in `onBegin`, collects every test via `onTestEnd`, and publishes + completes the run in `onEnd`.

Every option is documented in the [configuration reference](../README.md#configuration-reference).

## Test titles

Tag the test title with the Azure DevOps test case id:

```ts
test("C1234 login works", async ({ page }) => {
  // ...
});
```

## Native Playwright tags

Tags declared via Playwright's own `tag` option are checked before the title:

```ts
test("login works", { tag: ["@C1234", "@smoke"] }, async ({ page }) => {
  // ...
});
```

## playwright-bdd feature files

`playwright-bdd` compiles each Gherkin scenario into a real Playwright `TestCase`, but exposes `@tags` as `annotations` (type `"tag"`) rather than appending them to the title. The reporter merges native tags and tag annotations, checks both before falling back to the scenario name, so tag your scenarios the same way as the WDIO Cucumber integration:

```gherkin
@C1234
Scenario: User can log in
  Given the user is on the login page
  When they submit valid credentials
  Then they should see the dashboard
```

## Custom case id pattern

```ts
{
  caseIdPattern: /TC-(\d+)/, // matches "TC-1234" in titles or tags
}
```

The pattern must contain exactly one capturing group for the numeric id. It is applied consistently everywhere a case id is extracted — titles, native tags and playwright-bdd tag annotations — since all of them go through the same `extractTestCaseId(title, pattern, tags)` helper, which checks tags first and falls back to the title/scenario name.

## Per-test suite ids (`suiteIdPattern`)

By default every result is published to the single configured `suiteId`. If your test cases live in different suites of the same plan, pass `suiteIdPattern` instead — the suite id is then read from each test's tags or title, exactly like the case id:

```ts
{
  suiteIdPattern: /S-(\d+)/, // matches "S-456" in titles or tags
}
```

```ts
test("C1234 login", { tag: ["@S-456"] }, async ({ page }) => {
  // ...
});
```

```gherkin
@C1234 @S-456
Scenario: User can log in
  ...
```

When `suiteIdPattern` is set:

- the static `suiteId` option is **ignored** for every test whose tags or title match the pattern, so each test case can resolve to a different suite;
- `suiteId` is no longer mandatory — but keeping it is useful as a fallback, since tests that do **not** match the pattern still publish to it (without it, unmatched tests are skipped);
- test points are fetched once per distinct suite and matched back to the suite they came from, so the same case id appearing in two suites is no longer ambiguous.

## Sample feature file (`caseIdPattern` + `suiteIdPattern`)

The `playwright-bdd` example in [examples/login.feature](../examples/login.feature) works unchanged here. It assumes these reporter options:

```ts
{
  caseIdPattern: /TC-(\d+)/,  // reads the case id from @TC-<id>
  suiteIdPattern: /S-(\d+)/,  // reads the suite id from @S-<id>
  suiteId: 700,               // fallback for scenarios without an @S-<id> tag
}
```

```gherkin
@login
Feature: Login

  # Publishes case 1234 into suite 456.
  @TC-1234 @S-456
  Scenario: User can log in with valid credentials
    Given the user is on the login page
    When they submit valid credentials
    Then they should see the dashboard

  # Same feature, different suite: publishes case 1235 into suite 789.
  @TC-1235 @S-789
  Scenario: User sees an error for bad credentials
    Given the user is on the login page
    When they submit invalid credentials
    Then they should see an "Invalid username or password" error

  # No @S-<id> tag, so this falls back to the configured `suiteId` (700).
  @TC-1236
  Scenario: User can log out
    Given the user is logged in
    When they choose "Log out"
    Then they should be back on the login page

  # Ids can also live in the scenario name instead of tags.
  Scenario: TC-1237 S-456 Session expires after inactivity
    Given the user is logged in
    When the session times out
    Then they should be redirected to the login page
```

Running it produces one upload log line per scenario:

```
Publishing to Azure DevOps - suite 456, test case 1234: Passed
Publishing to Azure DevOps - suite 789, test case 1235: Failed
Publishing to Azure DevOps - suite 700, test case 1236: Passed
Publishing to Azure DevOps - suite 456, test case 1237: Passed
```

## Screenshots

The reporter attaches whatever screenshot Playwright itself captured on failure — it does not take a new one. Set `use.screenshot` to `"only-on-failure"` or `"on"` in your Playwright config for this to have an attachment to pick up. Disable the behaviour with `screenshotOnFailure: false`.

## Test configurations (Chromium vs WebKit, …)

If the same test case exists in your suite under several Azure DevOps _configurations_, tell the reporter which one its results belong to. Without this, a result published for one configuration can overwrite another configuration's result for the same case.

```ts
{
  configurationId: Number(process.env.ADO_CONFIGURATION_ID), // e.g. 1042 = Chromium
}
```

Since a Playwright reporter instance covers the whole run, run one Playwright process per configuration (e.g. one `--project` at a time) when you need to report against several:

```bash
ADO_CONFIGURATION_ID=1042 npx playwright test --project=chromium
ADO_CONFIGURATION_ID=1043 npx playwright test --project=webkit
```

Find the id under **Test Plans → Configurations**, or at `https://dev.azure.com/<org>/<project>/_apis/test/configurations`.

> While `configurationId` is set, points and results that have no configuration are skipped. Leave it unset for suites that don't use configurations.

## Reusing an existing Test Run

The reporter creates a run in `onBegin` **only** when no run id is available. The id is looked up in this order:

1. the `AZURE_DEVOPS_TEST_RUN_ID` environment variable, then
2. the `runId` reporter option.

Both `0` and an unset value mean "create a new run". To publish into a run created elsewhere (e.g. by an earlier pipeline stage, or by a WebdriverIO run in the same job):

```bash
# PowerShell
$env:AZURE_DEVOPS_TEST_RUN_ID = "12345"; npx playwright test

# bash
AZURE_DEVOPS_TEST_RUN_ID=12345 npx playwright test
```

```ts
import { RUN_ID_ENV_VAR } from "@virag8/azure-devops-test-publisher";

console.log(`Publishing into run ${process.env[RUN_ID_ENV_VAR]}`);
```

## Options and validation

`AzureDevOpsPlaywrightOptions` has the same shape as `AzureDevOpsWdioOptions` (see the [configuration reference](../README.md#configuration-reference)): `screenshotOnFailure`, `configurationId`, plus everything from `AzureDevOpsOptions`.

`orgUrl`, `projectId`, `planId` and `suiteId` are mandatory (`suiteId` only when `suiteIdPattern` is not set); a missing one throws `AzureDevOpsConfigError` when the reporter is constructed, before any test runs. A missing `token` is **not** an error — it disables publishing with a warning, which keeps local runs working without a PAT.

## Troubleshooting unmatched test cases

When a case id from a title or tag has no matching test point, the exact ids are logged:

```
No test point found for test case id(s) 9999 in project "MyProject", plan 123, suite 456, configuration 1042.
The suite exposes 12 point(s) for case id(s) 1001, 1002, … Check that the case ids in your test
titles belong to this plan/suite and configuration.
```

Common causes: the case lives in a different suite, the suite id belongs to another plan, or the reporter's `configurationId` doesn't match the point's configuration. Set `debug: true` to also dump the raw API payloads.
