import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveAppName, derivePackageName } from "../src/name-derivation";

describe("name derivation", () => {
  const originalCwd = process.cwd();
  let tempDirectory: string | undefined;

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "plancy-name-"));
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("derives a package name and app name from a kebab-case directory", () => {
    const packageName = derivePackageName("my-app");
    const appName = deriveAppName(packageName);

    expect(packageName).toBe("my-app");
    expect(appName).toBe("My App");
  });

  it("derives names for dot from the current directory basename", () => {
    const currentDirectory = path.join(tempDirectory ?? originalCwd, "My Cool App");

    fs.mkdirSync(currentDirectory, { recursive: true });
    process.chdir(currentDirectory);

    const packageName = derivePackageName(".");
    const appName = deriveAppName(packageName);

    expect(packageName).toBe("my-cool-app");
    expect(appName).toBe("My Cool App");
  });

  it("sanitizes punctuation and whitespace before validating the package name", () => {
    expect(derivePackageName("My Cool App!!!")).toBe("my-cool-app");
  });

  it("fails with a clear message when sanitizing produces an empty or invalid package name", () => {
    const tooLongName = "a".repeat(215);

    expect(() => derivePackageName("!!!")).toThrow(/valid npm package name/i);
    expect(() => derivePackageName(tooLongName)).toThrow(/valid npm package name/i);
  });

  it("prefers explicit overrides over derived package and app names", () => {
    expect(derivePackageName("my-app", "custom-package")).toBe("custom-package");
    expect(deriveAppName("my-app", "Custom App")).toBe("Custom App");
  });

  it("preserves valid scoped package-name overrides", () => {
    expect(derivePackageName("my-app", "@scope/app")).toBe("@scope/app");
    expect(deriveAppName("@scope/app")).toBe("App");
  });
});
