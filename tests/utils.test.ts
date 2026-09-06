import { extractTestCaseId } from "../src/utils";

describe("extractTestCaseId", () => {
  test("matches the default C123 pattern in a title", () => {
    expect(extractTestCaseId("C1234 login works")).toBe(1234);
  });

  test("matches the default #123 pattern in a title", () => {
    expect(extractTestCaseId("#5678 login works")).toBe(5678);
  });

  test("returns null when the title has no case id", () => {
    expect(extractTestCaseId("login works")).toBeNull();
  });

  test("honors a custom pattern", () => {
    expect(extractTestCaseId("TC-42 login works", /TC-(\d+)/)).toBe(42);
  });

  test("prefers a matching tag over the title", () => {
    expect(
      extractTestCaseId("User can log in", undefined, ["@smoke", "@C1234"]),
    ).toBe(1234);
  });

  test("falls back to the title when no tag matches (playwright-bdd style)", () => {
    expect(
      extractTestCaseId("C1234 User can log in", undefined, ["@smoke"]),
    ).toBe(1234);
  });

  test("returns null when neither tags nor the title have a case id", () => {
    expect(
      extractTestCaseId("User can log in", undefined, [
        "@smoke",
        "@regression",
      ]),
    ).toBeNull();
  });

  test("applies a custom pattern to tags as well as the title", () => {
    expect(extractTestCaseId("User can log in", /TC-(\d+)/, ["@TC-99"])).toBe(
      99,
    );
  });
});
