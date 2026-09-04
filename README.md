# wdio-azure-devops-service

Publish automated test results and failure screenshots from WebdriverIO (Mocha or Cucumber/BDD) — or any custom TypeScript test runner — directly to **Azure DevOps Test Plans**.

## Features

- **Single shared Test Run** — creates one Azure DevOps Test Run for the whole suite in the launcher process and shares its id with all parallel workers via an environment variable, so results from every spec land in the same run.
- **Mocha support** — extracts the Azure DevOps test case id from a test title (e.g. `C1234 login works`) via the `afterTest` hook.
- **Cucumber / BDD support** — extracts the test case id from a scenario's `@C1234` tag, falling back to the scenario name, via the `afterScenario` hook.
- **Custom case id pattern** — override the default `C123`/`#123` matcher with your own regex (e.g. `TC-(\d+)`) via `caseIdPattern`.
- **Automatic failure screenshots** — captures a browser screenshot and attaches it to the Azure DevOps result whenever a test/scenario fails (toggle with `screenshotOnFailure`).
- **Run reuse** — publish into an existing run (`runId`), or keep a single run open across multiple publishes (`reuseTestRun` / `keepRunOpen`) instead of creating a new run every time.
- **Point pre-fetch** — pass already-fetched test points via `PublishOptions.points` to skip a redundant Azure DevOps API call.
- **Resilient publishing** — publish failures are caught and logged so a flaky Azure DevOps API never fails the test run itself.
- **Standalone reporter service** — `AzureDevOpsReporterService` for custom/non-service integrations that just need `afterTest` + `onComplete` hooks.
- **Quiet by default** — set `debug: true` to log raw Azure DevOps API payloads while troubleshooting.
- **Fully typed** — ships with TypeScript declarations for all public options and result types.

## Installation

```bash
npm install --save-dev @virag8/wdio-azure-devops-service
```

Requires Node.js 18 or newer.

## Usage with WebdriverIO

Register the service in `wdio.conf.js` / `wdio.conf.ts`:

```js
const {
  AzureDevOpsWdioService,
} = require("@virag8/wdio-azure-devops-service");

exports.config = {
  // ...
  services: [
    [
      AzureDevOpsWdioService,
      {
        orgUrl: process.env.AZURE_ORG_URL,
        token: process.env.AZURE_PAT,
        projectName: "MyProject", // name or GUID
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

## Usage as a standalone reporter

For custom runners that aren't WebdriverIO services, use `AzureDevOpsReporterService` directly:

```ts
import { AzureDevOpsReporterService } from "@virag8/wdio-azure-devops-service";

const reporter = new AzureDevOpsReporterService({
  orgUrl: process.env.AZURE_ORG_URL!,
  token: process.env.AZURE_PAT!,
  projectName: "MyProject",
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
import { AzureDevOpsService } from "@virag8/wdio-azure-devops-service";

const ado = new AzureDevOpsService({
  orgUrl: process.env.AZURE_ORG_URL!,
  token: process.env.AZURE_PAT!,
  projectName: "MyProject",
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

## Configuration reference

### `AzureDevOpsOptions`

| Option          | Type       | Description                                                         |
| --------------- | ---------- | ------------------------------------------------------------------- |
| `orgUrl`        | `string`   | Azure DevOps organization URL.                                      |
| `token`         | `string`   | Personal access token with Test Plan read/write permissions.        |
| `projectName`   | `string`   | Azure DevOps project **name or id (GUID)** — both are accepted.     |
| `planId`        | `number`   | Test plan id.                                                       |
| `suiteId`       | `number`   | Test suite id within the plan.                                      |
| `runName`       | `string?`  | Custom name for created runs.                                       |
| `runId`         | `number?`  | Reuse this existing run instead of creating a new one.              |
| `reuseTestRun`  | `boolean?` | Keep a single run open across multiple `publishResults` calls.      |
| `caseIdPattern` | `RegExp?`  | Custom regex (one capturing group) for extracting the test case id. |
| `debug`         | `boolean?` | Log raw Azure DevOps API payloads. Defaults to `false`.             |

> **Note on `projectName`** — despite the name, this accepts either the project's display name (`"MyProject"`) or its GUID (`"b9e8c7cb-..."`). Prefer the GUID: it stays stable if the project is ever renamed, and it avoids URL-encoding issues with names that contain spaces. You can find it at `https://dev.azure.com/<org>/_apis/projects`.

### `AzureDevOpsWdioOptions` (extends `AzureDevOpsOptions`)

| Option                | Type       | Description                                                        |
| --------------------- | ---------- | ------------------------------------------------------------------ |
| `screenshotOnFailure` | `boolean?` | Attach a browser screenshot to failed results. Defaults to `true`. |

### `PublishOptions`

| Option        | Type           | Description                                                             |
| ------------- | -------------- | ----------------------------------------------------------------------- |
| `runId`       | `number?`      | Publish into this existing run instead of creating a new one.           |
| `points`      | `TestPoint[]?` | Reuse already-fetched test points instead of calling `getPoints` again. |
| `keepRunOpen` | `boolean?`     | Leave the run in progress so more results can be added later.           |

## Development

```bash
npm run test:unit   # mocked unit tests
npm run test:real   # integration tests against a real Azure DevOps org (requires env vars)
npm run build        # compile to dist/
```

## License

MIT
