# Sample feature file for custom `caseIdPattern` and `suiteIdPattern`.
#
# Reporter options used with this file:
#   caseIdPattern:  /TC-(\d+)/   -> reads the Azure DevOps test case id from @TC-<id>
#   suiteIdPattern: /S-(\d+)/    -> reads the Azure DevOps suite id from @S-<id>
#   suiteId:        700          -> fallback for scenarios without an @S-<id> tag
#
# Both patterns are matched against the scenario tags first, then the scenario name.

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

  # Each example row reports against the same case/suite pair as the outline's tags.
  @TC-1238 @S-789
  Scenario Outline: Login is rejected for locked accounts
    Given the account "<username>" is locked
    When they submit valid credentials
    Then they should see an "Account locked" error

    Examples:
      | username |
      | alice    |
      | bob      |
