# azure-devops-test-publisher

Publish automated test results and failure screenshots from WebdriverIO (Mocha or Cucumber/BDD) — or any custom TypeScript test runner — directly to **Azure DevOps Test Plans**.

## Features

- **Single shared Test Run** — creates one Azure DevOps Test Run for the whole suite in the launcher process and shares its id with all parallel workers via an environment variable, so results from every spec land in the same run.
- **Only executed tests appear in the run** — the run is created empty and test points are attached as tests finish, so cases in the suite that never ran are not left sitting in an _In progress_ state.
- **Mocha support** — extracts the Azure DevOps test case id from a test title (e.g. `C1234 login works`) via the `afterTest` hook.
- **Playwright support** — a native `Reporter` (`AzureDevOpsPlaywrightReporter`) for `@playwright/test`, importable from the `/playwright` subpath.
- **Cucumber / BDD support** — extracts the test case id from a scenario's `@C1234` tag, falling back to the scenario name, via the `afterScenario` hook.
- **Custom case id pattern** — override the default `C123`/`#123` matcher with your own regex (e.g. `TC-(\d+)`) via `caseIdPattern`.
- **Automatic failure screenshots** — captures a browser screenshot and attaches it to the Azure DevOps result whenever a test/scenario fails (toggle with `screenshotOnFailure`).
- **Configuration-aware publishing** — scope a publish to a single Azure DevOps configuration (Android vs iOS, Chrome vs Firefox, …) so parallel jobs never overwrite each other's results for the same test case.
- **Run reuse** — publish into an existing run (`runId`), or keep a single run open across multiple publishes (`reuseTestRun` / `keepRunOpen`) instead of creating a new run every time. A run is only created when no run id is supplied — `0` counts as "not supplied".
- **"Run by" populated** — results are stamped with the identity that owns the PAT instead of showing an empty _Run by_ column.
- **Point pre-fetch** — pass already-fetched test points via `PublishOptions.points` to skip a redundant Azure DevOps API call.
- **Fail-fast option validation** — a missing `orgUrl`, `projectId`, `planId` or `suiteId` throws a typed `AzureDevOpsConfigError` listing every offending key, at construction time rather than mid-run.
- **Actionable diagnostics** — warnings name the project, plan, suite, configuration and the exact test case ids that could not be matched.
- **Resilient publishing** — publish failures are caught and logged so a flaky Azure DevOps API never fails the test run itself.
- **Standalone reporter service** — `AzureDevOpsReporterService` for custom/non-service integrations that just need `afterTest` + `onComplete` hooks.
- **Quiet by default** — set `debug: true` to log raw Azure DevOps API payloads while troubleshooting.
- **Fully typed** — ships with TypeScript declarations for all public options and result types.

## Installation

```bash
npm install --save-dev @virag8/azure-devops-test-publisher
```

Requires Node.js 18 or newer.

## Usage with WebdriverIO

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

### Mocha specs

Tag the test title with the Azure DevOps test case id:

```js
it("C1234 login", async () => { ... });
```

### Cucumber / BDD feature files

Tag the scenario with `@C<testCaseId>`:

```gherkin
@C1234
Scenario: User can log in
  Given the user is on the login page
  When they submit valid credentials
  Then they should see the dashboard
```

If no tag is present, the case id is parsed from the scenario name instead.

### Custom case id pattern

```js
{
  caseIdPattern: /TC-(\d+)/, // matches "TC-1234" in titles or tags
}
```

The pattern must contain exactly one capturing group for the numeric id.

### Test configurations (Android vs iOS, Chrome vs Firefox, …)

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

### Reusing an existing Test Run

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

### Validating configuration early

`orgUrl`, `projectId`, `planId` and `suiteId` are mandatory. If any is missing or malformed, construction throws `AzureDevOpsConfigError` before a single test runs:

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

### Troubleshooting unmatched test cases

When a case id from a title or tag has no matching test point, the exact ids are logged:

```
No test point found for test case id(s) 9999 in project "MyProject", plan 123, suite 456, configuration 1042.
The suite exposes 12 point(s) for case id(s) 1001, 1002, … Check that the case ids in your test
titles belong to this plan/suite and configuration.
```

Common causes: the case lives in a different suite, the suite id belongs to another plan, or the worker's `configurationId` doesn't match the point's configuration. Set `debug: true` to also dump the raw API payloads.

## Usage with Playwright

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

### Test titles

Tag the test title with the Azure DevOps test case id, same as Mocha:

```ts
test("C1234 login works", async ({ page }) => {
  // ...
});
```

### Screenshots

The reporter attaches whatever screenshot Playwright itself captured on failure — it does not take a new one. Set `use.screenshot` to `"only-on-failure"` or `"on"` in your Playwright config for this to have an attachment to pick up.

### Options

`AzureDevOpsPlaywrightOptions` has the same shape as `AzureDevOpsWdioOptions` (see [Configuration reference](#configuration-reference)): `screenshotOnFailure`, `configurationId`, plus everything from `AzureDevOpsOptions`. The same `runId`, `configurationId`, and `AzureDevOpsConfigError` behavior described above for WebdriverIO applies here too.

## Usage as a standalone reporter

For custom runners that aren't WebdriverIO services, use `AzureDevOpsReporterService` directly:

```ts
import { AzureDevOpsReporterService } from "@virag8/azure-devops-test-publisher";

const reporter = new AzureDevOpsReporterService({
  orgUrl: process.env.AZURE_ORG_URL!,
  token: process.env.AZURE_PAT!,
  projectId: "MyProject",
  planId: 123,
  suiteId: 456,
});

await reporter.afterTest(
  { title: "C1234 login", duration: 250 },
  {},
  { passed: true },
);
await reporter.onComplete();
```

## Using the low-level `AzureDevOpsService`

Both the WDIO service and the reporter are built on `AzureDevOpsService`, which you can use directly for full control over run creation and result publishing:

```ts
import { AzureDevOpsService } from "@virag8/azure-devops-test-publisher";

const ado = new AzureDevOpsService({
  orgUrl: process.env.AZURE_ORG_URL!,
  token: process.env.AZURE_PAT!,
  projectId: "MyProject",
  planId: 123,
  suiteId: 456,
});

await ado.publishResults([
  {
    testCaseId: 1234,
    outcome: "Passed",
    durationInMs: 250,
  },
]);
```

Scope a publish to one configuration, and keep the run open for later batches:

```ts
const runId = await ado.createRun();

await ado.publishResults(
  [{ testCaseId: 1234, outcome: "Failed", errorMessage: "boom" }],
  { runId, configurationId: 1042, keepRunOpen: true },
);

await ado.completeRun(runId);
```

`createRun()` creates an **empty** run; points are attached by `publishResults` as results come in, so cases that never executed stay out of the run.

## Configuration reference

### `AzureDevOpsOptions`

| Option          | Type       | Description                                                                          |
| --------------- | ---------- | ------------------------------------------------------------------------------------ |
| `orgUrl`        | `string`   | Azure DevOps organization URL.                                                       |
| `token`         | `string`   | Personal access token with Test Plan read/write permissions.                         |
| `projectId`     | `string`   | Azure DevOps project **name or id (GUID)** — both are accepted.                      |
| `planId`        | `number`   | Test plan id.                                                                        |
| `suiteId`       | `number`   | Test suite id within the plan.                                                       |
| `runName`       | `string?`  | Custom name for created runs.                                                        |
| `runId`         | `number?`  | Reuse this existing run instead of creating a new one. `0` means "create a new run". |
| `reuseTestRun`  | `boolean?` | Keep a single run open across multiple `publishResults` calls.                       |
| `caseIdPattern` | `RegExp?`  | Custom regex (one capturing group) for extracting the test case id.                  |
| `debug`         | `boolean?` | Log raw Azure DevOps API payloads. Defaults to `false`.                              |

> **Note on `projectId`** — despite the name, this accepts either the project's display name (`"MyProject"`) or its GUID (`"b9e8c7cb-..."`). Prefer the GUID: it stays stable if the project is ever renamed, and it avoids URL-encoding issues with names that contain spaces. You can find it at `https://dev.azure.com/<org>/_apis/projects`.

### `AzureDevOpsWdioOptions` (extends `AzureDevOpsOptions`)

| Option                | Type       | Description                                                                                                                                                                                                                                                                            |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screenshotOnFailure` | `boolean?` | Attach a browser screenshot to failed results. Defaults to `true`.                                                                                                                                                                                                                     |
| `configurationId`     | `number?`  | Azure DevOps test configuration id for this worker (e.g. Android vs iOS). Set this when the same test case is configured for multiple configurations in your suite, otherwise a result published for one configuration can overwrite another configuration's result for the same case. |

### `PublishOptions`

| Option            | Type           | Description                                                                                               |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `runId`           | `number?`      | Publish into this existing run instead of creating a new one. `0` is treated as "not set".                |
| `points`          | `TestPoint[]?` | Reuse already-fetched test points instead of calling `getPoints` again.                                   |
| `configurationId` | `number?`      | Only publish to the test point/result of this configuration id; points and results in others are skipped. |
| `keepRunOpen`     | `boolean?`     | Leave the run in progress so more results can be added later.                                             |

### `AzureDevOpsConfigError`

| Member    | Type       | Description                                             |
| --------- | ---------- | ------------------------------------------------------- |
| `missing` | `string[]` | The mandatory option keys that were missing or invalid. |
| `message` | `string`   | Human readable summary listing every offending key.     |

## Development

```bash
npm run test:unit   # mocked unit tests
npm run test:real   # integration tests against a real Azure DevOps org (requires env vars)
npm run build        # compile to dist/
```

`npm run test:real` reads its credentials from a local `.env` file (`AZURE_ORG_URL`, `AZURE_PAT`, `AZURE_PROJECT`, `AZURE_PLAN_ID`, `AZURE_SUITE_ID`, `AZURE_TEST_CASE_ID`) and skips itself when they are absent.

## License

MIT
