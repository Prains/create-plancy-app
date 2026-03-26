import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli";
import { runCreateApp } from "../src/main";

type WriteTarget = {
  write(chunk: string): boolean;
};

function createBuffer(): { output: string; stream: WriteTarget } {
  let output = "";

  return {
    get output() {
      return output;
    },
    stream: {
      write(chunk: string) {
        output += chunk;

        return true;
      },
    },
  };
}

describe("runCreateApp", () => {
  it("prompts once for a directory in interactive mode when missing", async () => {
    const promptForDirectory = vi.fn(async () => "demo-app");
    const createApp = vi.fn(async () => undefined);

    await runCreateApp(
      {
        cwd: "/workspace/current",
        interactive: true,
      },
      {
        promptForDirectory,
        createApp,
      },
    );

    expect(promptForDirectory).toHaveBeenCalledTimes(1);
    expect(createApp).toHaveBeenCalledWith({
      targetDirectory: "/workspace/current/demo-app",
      templateVersion: undefined,
      packageName: "demo-app",
      appName: "Demo App",
      skipGitInit: false,
    });
  });

  it("uses the current working directory when the target is dot", async () => {
    const createApp = vi.fn(async () => undefined);

    await runCreateApp(
      {
        directory: ".",
        cwd: "/workspace/current/plancy-demo",
        interactive: false,
      },
      {
        promptForDirectory: vi.fn(),
        createApp,
      },
    );

    expect(createApp).toHaveBeenCalledWith({
      targetDirectory: "/workspace/current/plancy-demo",
      templateVersion: undefined,
      packageName: "plancy-demo",
      appName: "Plancy Demo",
      skipGitInit: false,
    });
  });
});

describe("runCli", () => {
  it("prints usage and exits with code 1 when directory is missing in non-interactive mode", async () => {
    const stderr = createBuffer();
    const createApp = vi.fn(async () => undefined);

    const exitCode = await runCli([], {
      cwd: "/workspace/current",
      interactive: false,
      stderr: stderr.stream,
      createApp,
      promptForDirectory: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(createApp).not.toHaveBeenCalled();
    expect(stderr.output).toContain("Usage: bun create plancy-app <directory>");
  });

  it("parses flags and forwards them into the create flow", async () => {
    const createApp = vi.fn(async () => undefined);

    const exitCode = await runCli(
      [
        "demo-app",
        "--template-version",
        "1.2.3",
        "--package-name",
        "demo-package",
        "--app-name",
        "Demo App",
        "--skip-git-init",
      ],
      {
        cwd: "/workspace/current",
        interactive: false,
        stderr: createBuffer().stream,
        createApp,
        promptForDirectory: vi.fn(),
      },
    );

    expect(exitCode).toBe(0);
    expect(createApp).toHaveBeenCalledWith({
      targetDirectory: "/workspace/current/demo-app",
      templateVersion: "1.2.3",
      packageName: "demo-package",
      appName: "Demo App",
      skipGitInit: true,
    });
  });

  it("accepts flag values that start with double dashes", async () => {
    const createApp = vi.fn(async () => undefined);

    const exitCode = await runCli(
      [
        "demo-app",
        "--app-name",
        "--Demo App",
      ],
      {
        cwd: "/workspace/current",
        interactive: false,
        stderr: createBuffer().stream,
        createApp,
        promptForDirectory: vi.fn(),
      },
    );

    expect(exitCode).toBe(0);
    expect(createApp).toHaveBeenCalledWith({
      targetDirectory: "/workspace/current/demo-app",
      templateVersion: undefined,
      packageName: "demo-app",
      appName: "--Demo App",
      skipGitInit: false,
    });
  });

  it("derives a humanized app name from a scoped package override", async () => {
    const createApp = vi.fn(async () => undefined);

    const exitCode = await runCli(
      ["demo-app", "--package-name", "@scope/app"],
      {
        cwd: "/workspace/current",
        interactive: false,
        stderr: createBuffer().stream,
        createApp,
        promptForDirectory: vi.fn(),
      },
    );

    expect(exitCode).toBe(0);
    expect(createApp).toHaveBeenCalledWith({
      targetDirectory: "/workspace/current/demo-app",
      templateVersion: undefined,
      packageName: "@scope/app",
      appName: "App",
      skipGitInit: false,
    });
  });

  it("supports a double-dash terminator before positional directories", async () => {
    const createApp = vi.fn(async () => undefined);

    const exitCode = await runCli(["--", "--demo-app"], {
      cwd: "/workspace/current",
      interactive: false,
      stderr: createBuffer().stream,
      createApp,
      promptForDirectory: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(createApp).toHaveBeenCalledWith({
      targetDirectory: "/workspace/current/--demo-app",
      templateVersion: undefined,
      packageName: "demo-app",
      appName: "Demo App",
      skipGitInit: false,
    });
  });

  it("fails explicitly when no create flow implementation is wired", async () => {
    const stderr = createBuffer();

    const exitCode = await runCli(["demo-app"], {
      cwd: "/workspace/current",
      interactive: false,
      stderr: stderr.stream,
      promptForDirectory: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(stderr.output).toContain("CLI create flow is not implemented");
  });
});
