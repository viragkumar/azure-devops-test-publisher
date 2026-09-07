# WebdriverIO guide

Publishing WebdriverIO (Mocha or Cucumber/BDD) results to Azure DevOps Test Plans with `AzureDevOpsWdioService`.

← Back to the [main README](../README.md) · Using Playwright instead? See the [Playwright guide](playwright.md).

## Contents

- [Setup](#setup)
- [Mocha specs](#mocha-specs)
- [Cucumber / BDD feature files](#cucumber--bdd-feature-files)
- [Custom case id pattern](#custom-case-id-pattern)
- [Per-test suite ids (`suiteIdPattern`)](#per-test-suite-ids-suiteidpattern)
- [Sample feature file](#sample-feature-file-caseidpattern--suiteidpattern)
- [Test configurations](#test-configurations-android-vs-ios-chrome-vs-firefox-)
- [Reusing an existing Test Run](#reusing-an-existing-test-run)
- [Validating configuration early](#validating-configuration-early)
- [Troubleshooting unmatched test cases](#troubleshooting-unmatched-test-cases)

## Setup

Register the service in `wdio.conf.js` / `wdio.conf.ts`:

```js
const {
  AzureDevOpsWdioService,
} = require("@virag8/azure-devops-test-publisher");

exports.config = {
  // ...
  services: [
    [
      AzureDevOpsWdioService,
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
};
```

The service creates the Test Run in `onPrepare`, collects results from every worker via `afterTest`/`afterScenario`, publishes them in `after`, and completes the run in `onComplete`.

Every option is documented in the [configuration reference](../README.md#configuration-reference).

## Mocha specs

Tag the test title with the Azure DevOps test case id:

```js
it("C1234 login", async () => { ... });
```

## Cucumber / BDD feature files

Tag the scenario with `@C<testCaseId>`:

```gherkin
@C1234
Scenario: User can log in
  Given the user is on the login page
  When they submit valid credentials
  Then they should see the dashboard
```

If no tag is present, the case id is parsed from the scenario name instead.

## Custom case id pattern

```js
{
  caseIdPattern: /TC-(\d+)/, // matches "TC-1234" in titles or tags
}
```

The pattern must contain exactly one capturing group for the numeric id. It is applied consistently everywhere a case id is extracted — Mocha titles and Cucumber `@tags` — since both go through the same `extractTestCaseId(title, pattern, tags)` helper, which checks tags first and falls back to the title/scenario name.

## Per-test suite ids (`suiteIdPattern`)

By default every result is published to the single configured `suiteId`. If your test cases live in different suites of the same plan, pass `suiteIdPattern` instead — the suite id is then read from each test's tags or title, exactly like the case id:

```js
{
  suiteIdPattern: /S-(\d+)/, // matches "S-456" in titles or tags
}
```

```js
it("C1234 S-456 login", async () => { ... });
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

A complete example lives in [examples/login.feature](../examples/login.feature). It assumes these service options:

```js
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

The same file works unchanged with `playwright-bdd` — see the [Playwright guide](playwright.md#playwright-bdd-feature-files).

## Test configurations (Android vs iOS, Chrome vs Firefox, …)

If the same test case exists in your suite under several Azure DevOps _configurations_, tell each worker which configuration it represents. Without this, a result published for one configuration can overwrite another configuration's result for the same case.

```js
{
  configurationId: Number(process.env.ADO_CONFIGURATION_ID), // e.g. 1042 = Android
}
```

With `configurationId` set, the service:

- attaches only the test point belonging to that configuration to the run, and
- updates only the result for that configuration, leaving the others untouched.

Run one WebdriverIO process per configuration:

```bash
ADO_CONFIGURATION_ID=1042 npx wdio run wdio.android.conf.ts
ADO_CONFIGURATION_ID=1043 npx wdio run wdio.ios.conf.ts
```

Find the id under **Test Plans → Configurations**, or at `https://dev.azure.com/<org>/<project>/_apis/test/configurations`.

> While `configurationId` is set, points and results that have no configuration are skipped. Leave it unset for suites that don't use configurations.

## Reusing an existing Test Run

A run is created in `onPrepare` **only** when no run id is available. The id is looked up in this order:

1. the `AZURE_DEVOPS_TEST_RUN_ID` environment variable, then
2. the `runId` service option.

Both `0` and an unset value mean "create a new run". To publish into a run created elsewhere (e.g. by an earlier pipeline stage):

```bash
# PowerShell
$env:AZURE_DEVOPS_TEST_RUN_ID = "12345"; npx wdio run wdio.conf.ts

# bash
AZURE_DEVOPS_TEST_RUN_ID=12345 npx wdio run wdio.conf.ts
```

The variable name is exported as a constant so you don't have to hardcode it:

```ts
import { RUN_ID_ENV_VAR } from "@virag8/azure-devops-test-publisher";

console.log(`Publishing into run ${process.env[RUN_ID_ENV_VAR]}`);
```

Workers inherit the variable from the launcher process, so it is readable inside specs and hooks. It is cleared again in `onComplete` and does not propagate back to the shell that started WebdriverIO.

## Validating configuration early

`orgUrl`, `projectId`, `planId` and `suiteId` are mandatory (`suiteId` only when `suiteIdPattern` is not set). If any is missing or malformed, construction throws `AzureDevOpsConfigError` before a single test runs:

```ts
import {
  AzureDevOpsService,
  AzureDevOpsConfigError,
} from "@virag8/azure-devops-test-publisher";

try {
  new AzureDevOpsService(options);
} catch (err) {
  if (err instanceof AzureDevOpsConfigError) {
    console.error("Bad Azure DevOps config:", err.missing); // e.g. ["planId", "suiteId"]
  }
}
```

```
AzureDevOpsConfigError: Missing or invalid Azure DevOps option(s): planId, suiteId.
Provide them when constructing the service or in the wdio service options.
```

A missing `token` is **not** an error — it simply disables publishing with a warning, which keeps local runs working without a PAT.

## Troubleshooting unmatched test cases

When a case id from a title or tag has no matching test point, the exact ids are logged:

```
No test point found for test case id(s) 9999 in project "MyProject", plan 123, suite 456, configuration 1042.
The suite exposes 12 point(s) for case id(s) 1001, 1002, … Check that the case ids in your test
titles belong to this plan/suite and configuration.
```

Common causes: the case lives in a different suite, the suite id belongs to another plan, or the worker's `configurationId` doesn't match the point's configuration. Set `debug: true` to also dump the raw API payloads.
