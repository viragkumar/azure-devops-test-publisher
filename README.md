# azure-devops-test-publisher

Publish automated test results and failure screenshots from WebdriverIO (Mocha or Cucumber/BDD), Playwright — or any custom TypeScript test runner — directly to **Azure DevOps Test Plans**.

## Guides

Pick your runner — each guide starts with the config snippet to copy:

| Runner                                              | Guide                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| **WebdriverIO** (Mocha, Cucumber / BDD)             | [docs/webdriverio.md](docs/webdriverio.md#setup)                        |
| **Playwright** (`@playwright/test`, playwright-bdd) | [docs/playwright.md](docs/playwright.md#setup)                          |
| Custom / any runner                                 | [Usage as a standalone reporter](#usage-as-a-standalone-reporter) below |

Options shared by all of them live in the [configuration reference](#configuration-reference).

## Features

- **Single shared Test Run** — creates one Azure DevOps Test Run for the whole suite in the launcher process and shares its id with all parallel workers via an environment variable, so results from every spec land in the same run.
- **Only executed tests appear in the run** — the run is created empty and test points are attached as tests finish, so cases in the suite that never ran are not left sitting in an _In progress_ state.
- **Mocha support** — extracts the Azure DevOps test case id from a test title (e.g. `C1234 login works`) via the `afterTest` hook.
- **Playwright support** — a native `Reporter` (`AzureDevOpsPlaywrightReporter`) for `@playwright/test`, importable from the `/playwright` subpath.
- **Cucumber / BDD support** — extracts the test case id from a scenario's `@C1234` tag (Cucumber pickle tags or playwright-bdd annotations), falling back to the scenario name, via a shared tag-aware extractor.
- **Custom case id pattern** — override the default `C123`/`#123` matcher with your own regex (e.g. `TC-(\d+)`) via `caseIdPattern`.
- **Per-test suite ids** — set `suiteIdPattern` to read the suite id from each test's tags or title (e.g. `S-456`), so a single run can publish to many suites at once. The static `suiteId` option is ignored when this pattern matches.
- **Automatic failure screenshots** — captures a browser screenshot and attaches it to the Azure DevOps result whenever a test/scenario fails (toggle with `screenshotOnFailure`).
- **Configuration-aware publishing** — scope a publish to a single Azure DevOps configuration (Android vs iOS, Chrome vs Firefox, …) so parallel jobs never overwrite each other's results for the same test case.
- **Run reuse** — publish into an existing run (`runId`), or keep a single run open across multiple publishes (`reuseTestRun` / `keepRunOpen`) instead of creating a new run every time. A run is only created when no run id is supplied — `0` counts as "not supplied".
- **"Run by" populated** — results are stamped with the identity that owns the PAT instead of showing an empty _Run by_ column.
- **Point pre-fetch** — pass already-fetched test points via `PublishOptions.points` to skip a redundant Azure DevOps API call.
- **Fail-fast option validation** — a missing `orgUrl`, `projectId`, `planId` or `suiteId` throws a typed `AzureDevOpsConfigError` listing every offending key, at construction time rather than mid-run (`suiteId` is not required when `suiteIdPattern` is set).
- **Per-result upload log** — both reporters print one `suite <id>, test case <id>: <outcome>` line per result as it is published, so the console shows exactly what landed where.
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

## Identifying test cases and suites

Both runners share the same extraction rules — tags are checked first, then the test title / scenario name:

| Option           | Default                 | Purpose                                                  |
| ---------------- | ----------------------- | -------------------------------------------------------- |
| `caseIdPattern`  | `C123` / `#123`         | Which Azure DevOps test case a result belongs to.        |
| `suiteIdPattern` | _none_ (uses `suiteId`) | Which suite a result belongs to, resolved per test case. |

Each pattern must contain exactly one capturing group for the numeric id. A sample Gherkin file using both is in [examples/login.feature](examples/login.feature), walked through in the [WebdriverIO](docs/webdriverio.md#sample-feature-file-caseidpattern--suiteidpattern) and [Playwright](docs/playwright.md#sample-feature-file-caseidpattern--suiteidpattern) guides.

As results are published, each one is logged with the suite it landed in:

```
Publishing to Azure DevOps - suite 456, test case 1234: Passed
Publishing to Azure DevOps - suite 789, test case 1235: Failed
```

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

Pass a per-result `suiteId` to publish one batch across several suites; points are fetched once per distinct suite:

```ts
await ado.publishResults([
  { testCaseId: 1234, suiteId: 456, outcome: "Passed" },
  { testCaseId: 1235, suiteId: 789, outcome: "Failed" },
]);
```

## Configuration reference

### `AzureDevOpsOptions`

| Option           | Type       | Description                                                                                                                                                 |
| ---------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orgUrl`         | `string`   | Azure DevOps organization URL.                                                                                                                              |
| `token`          | `string`   | Personal access token with Test Plan read/write permissions.                                                                                                |
| `projectId`      | `string`   | Azure DevOps project **name or id (GUID)** — both are accepted.                                                                                             |
| `planId`         | `number`   | Test plan id.                                                                                                                                               |
| `suiteId`        | `number?`  | Test suite id within the plan. Required unless `suiteIdPattern` is set; when both are given it is only the fallback for tests that don't match the pattern. |
| `runName`        | `string?`  | Custom name for created runs.                                                                                                                               |
| `runId`          | `number?`  | Reuse this existing run instead of creating a new one. `0` means "create a new run".                                                                        |
| `reuseTestRun`   | `boolean?` | Keep a single run open across multiple `publishResults` calls.                                                                                              |
| `caseIdPattern`  | `RegExp?`  | Custom regex (one capturing group) for extracting the test case id.                                                                                         |
| `suiteIdPattern` | `RegExp?`  | Regex (one capturing group) that reads the suite id from each test's tags or title. Overrides `suiteId` per test case.                                      |
| `debug`          | `boolean?` | Log raw Azure DevOps API payloads. Defaults to `false`.                                                                                                     |

> **Note on `projectId`** — despite the name, this accepts either the project's display name (`"MyProject"`) or its GUID (`"b9e8c7cb-..."`). Prefer the GUID: it stays stable if the project is ever renamed, and it avoids URL-encoding issues with names that contain spaces. You can find it at `https://dev.azure.com/<org>/_apis/projects`.

### `AzureDevOpsWdioOptions` / `AzureDevOpsPlaywrightOptions` (extend `AzureDevOpsOptions`)

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

`orgUrl`, `projectId`, `planId` and `suiteId` are validated when a service/reporter is constructed, before any test runs (`suiteId` only when `suiteIdPattern` is not set). A missing `token` is **not** an error — it disables publishing with a warning, which keeps local runs working without a PAT.

## Development

```bash
npm run test:unit   # mocked unit tests
npm run test:real   # integration tests against a real Azure DevOps org (requires env vars)
npm run build        # compile to dist/
```

`npm run test:real` reads its credentials from a local `.env` file (`AZURE_ORG_URL`, `AZURE_PAT`, `AZURE_PROJECT`, `AZURE_PLAN_ID`, `AZURE_SUITE_ID`, `AZURE_TEST_CASE_ID`) and skips itself when they are absent.

> Using pnpm instead of npm? pnpm 10+ blocks install scripts from `jest`'s optional native deps (`@parcel/watcher`, `unrs-resolver`) by default. This repo's [pnpm-workspace.yaml](pnpm-workspace.yaml) pre-approves them via `allowBuilds`; if you see `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds` or add the equivalent entries yourself.

## License

MIT
