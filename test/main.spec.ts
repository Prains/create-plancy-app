import os from "node:os";
import path from "node:path";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli";
import { runCreateApp, createPlancyApp } from "../src/main";

type WriteTarget = {
  write(chunk: string): boolean;
  isTTY?: boolean;
};

const tempDirectories: string[] = [];

async function createTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function createBuffer(isTTY = false): { output: string; stream: WriteTarget } {
  let output = "";

  return {
    get output() {
      return output;
    },
    stream: {
      isTTY,
      write(chunk: string) {
        output += chunk;

        return true;
      },
    },
  };
}

async function writeStarterTemplate(
  extractedDirectory: string,
  overrides: Partial<{
    copyEnvExampleToEnv: boolean;
    defaultGitInit: boolean;
  }> = {},
): Promise<void> {
  await mkdir(extractedDirectory, { recursive: true });
  await writeFile(
    path.join(extractedDirectory, "starter.manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      templateVersion: "1.2.3",
      packageNameToken: "__PACKAGE_NAME__",
      appNameToken: "__APP_NAME__",
      packageNameFiles: ["package.json"],
      appNameFiles: ["README.md"],
      copyEnvExampleToEnv: overrides.copyEnvExampleToEnv ?? false,
      defaultGitInit: overrides.defaultGitInit ?? true,
    }),
  );
  await writeFile(
    path.join(extractedDirectory, "package.json"),
    '{"name":"__PACKAGE_NAME__"}',
  );
  await writeFile(path.join(extractedDirectory, "README.md"), "__APP_NAME__\n");
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
      overwrite: false,
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
      overwrite: false,
    });
  });

  it("prompts before overwriting a non-empty target directory in interactive mode", async () => {
    const workspaceRoot = await createTempDirectory("run-create-overwrite-");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const createApp = vi.fn(async () => undefined);
    const promptForOverwrite = vi.fn(async () => true);

    await mkdir(targetDirectory, { recursive: true });
    await writeFile(path.join(targetDirectory, "keep.txt"), "existing content\n");

    await runCreateApp(
      {
        directory: "demo-app",
        cwd: workspaceRoot,
        interactive: true,
      },
      {
        createApp,
        promptForDirectory: vi.fn(),
        promptForOverwrite,
      },
    );

    expect(promptForOverwrite).toHaveBeenCalledWith(targetDirectory);
    expect(createApp).toHaveBeenCalledWith({
      targetDirectory,
      templateVersion: undefined,
      packageName: "demo-app",
      appName: "Demo App",
      skipGitInit: false,
      overwrite: true,
    });
  });

  it("cancels before create flow when overwrite is declined", async () => {
    const workspaceRoot = await createTempDirectory("run-create-overwrite-");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const createApp = vi.fn(async () => undefined);

    await mkdir(targetDirectory, { recursive: true });
    await writeFile(path.join(targetDirectory, "keep.txt"), "existing content\n");

    await expect(
      runCreateApp(
        {
          directory: "demo-app",
          cwd: workspaceRoot,
          interactive: true,
        },
        {
          createApp,
          promptForDirectory: vi.fn(),
          promptForOverwrite: vi.fn(async () => false),
        },
      ),
    ).rejects.toThrow(/Canceled scaffolding/i);

    expect(createApp).not.toHaveBeenCalled();
  });
});

describe("createPlancyApp", () => {
  it("skips git initialization when --skip-git-init is set", async () => {
    const workspaceRoot = await createTempDirectory("main-flow-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const stdout = createBuffer();
    const stderr = createBuffer();
    const tryInitGit = vi.fn(async () => ({ ok: true as const }));

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: true });

    await createPlancyApp(
      {
        targetDirectory,
        packageName: "demo-app",
        appName: "Demo App",
        skipGitInit: true,
        overwrite: false,
      },
      {
        resolveRelease: async () => ({
          assetName: "starter-web-v1.2.3.tar.gz",
          downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          tagName: "v1.2.3",
          templateVersion: "1.2.3",
        }),
        downloadTemplate: async () => ({
          extractedDirectory,
          cleanup: async () => undefined,
        }),
        tryInitGit,
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
    );

    expect(tryInitGit).not.toHaveBeenCalled();
    expect(stderr.output).toBe("");
    expect(stdout.output).toBe(
      "bun install\n# set DATABASE_URL in .env\nbunx prisma migrate dev\nbun run dev\n",
    );
  });

  it("prints styled progress output when stdout is a TTY", async () => {
    const workspaceRoot = await createTempDirectory("main-flow-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const stdout = createBuffer(true);
    const stderr = createBuffer();

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: false });

    await createPlancyApp(
      {
        targetDirectory,
        packageName: "demo-app",
        appName: "Demo App",
        skipGitInit: false,
        overwrite: false,
      },
      {
        resolveRelease: async () => ({
          assetName: "starter-web-v1.2.3.tar.gz",
          downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          tagName: "v1.2.3",
          templateVersion: "1.2.3",
        }),
        downloadTemplate: async () => ({
          extractedDirectory,
          cleanup: async () => undefined,
        }),
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
    );

    expect(stderr.output).toBe("");
    expect(stdout.output).toContain("create-plancy-app");
    expect(stdout.output).toContain("Resolving starter release");
    expect(stdout.output).toContain("Writing project files");
    expect(stdout.output).toContain("Project ready");
    expect(stdout.output).toContain("bun install");
  });

  it("prints a warning step in TTY mode when git init fails", async () => {
    const workspaceRoot = await createTempDirectory("main-flow-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const stdout = createBuffer(true);
    const stderr = createBuffer();

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: true });

    await createPlancyApp(
      {
        targetDirectory,
        packageName: "demo-app",
        appName: "Demo App",
        skipGitInit: false,
        overwrite: false,
      },
      {
        resolveRelease: async () => ({
          assetName: "starter-web-v1.2.3.tar.gz",
          downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          tagName: "v1.2.3",
          templateVersion: "1.2.3",
        }),
        downloadTemplate: async () => ({
          extractedDirectory,
          cleanup: async () => undefined,
        }),
        tryInitGit: async () => ({
          ok: false as const,
          error: "git init failed",
        }),
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
    );

    expect(stdout.output).toContain("Initializing git repository");
    expect(stdout.output).toContain("[!]");
    expect(stderr.output).toBe("Warning: git init failed\n");
  });

  it("skips git initialization when the manifest disables it by default", async () => {
    const workspaceRoot = await createTempDirectory("main-flow-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const tryInitGit = vi.fn(async () => ({ ok: true as const }));
    const stdout = createBuffer();
    const stderr = createBuffer();

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: false });

    await createPlancyApp(
      {
        targetDirectory,
        packageName: "demo-app",
        appName: "Demo App",
        skipGitInit: false,
        overwrite: false,
      },
      {
        resolveRelease: async () => ({
          assetName: "starter-web-v1.2.3.tar.gz",
          downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          tagName: "v1.2.3",
          templateVersion: "1.2.3",
        }),
        downloadTemplate: async () => ({
          extractedDirectory,
          cleanup: async () => undefined,
        }),
        stdout: stdout.stream,
        stderr: stderr.stream,
        tryInitGit,
      },
    );

    expect(tryInitGit).not.toHaveBeenCalled();
    expect(stderr.output).toBe("");
    expect(stdout.output).toBe(
      "bun install\n# set DATABASE_URL in .env\nbunx prisma migrate dev\nbun run dev\n",
    );
  });

  it("warns on git init failure without rolling back the scaffolded project", async () => {
    const workspaceRoot = await createTempDirectory("main-flow-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const stdout = createBuffer();
    const stderr = createBuffer();

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: true });

    await createPlancyApp(
      {
        targetDirectory,
        packageName: "demo-app",
        appName: "Demo App",
        skipGitInit: false,
        overwrite: false,
      },
      {
        resolveRelease: async () => ({
          assetName: "starter-web-v1.2.3.tar.gz",
          downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          tagName: "v1.2.3",
          templateVersion: "1.2.3",
        }),
        downloadTemplate: async () => ({
          extractedDirectory,
          cleanup: async () => undefined,
        }),
        tryInitGit: async () => ({
          ok: false as const,
          error: "git init failed",
        }),
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
    );

    expect(await readFile(path.join(targetDirectory, "package.json"), "utf8")).toContain(
      '"name":"demo-app"',
    );
    expect(stderr.output).toBe("Warning: git init failed\n");
    expect(stdout.output).toBe(
      "bun install\n# set DATABASE_URL in .env\nbunx prisma migrate dev\nbun run dev\n",
    );
  });

  it("ignores downloaded-template cleanup failures after a successful scaffold", async () => {
    const workspaceRoot = await createTempDirectory("main-flow-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const stdout = createBuffer();
    const stderr = createBuffer();

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: false });

    await expect(
      createPlancyApp(
        {
          targetDirectory,
          packageName: "demo-app",
          appName: "Demo App",
          skipGitInit: false,
          overwrite: false,
        },
        {
          resolveRelease: async () => ({
            assetName: "starter-web-v1.2.3.tar.gz",
            downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
            tagName: "v1.2.3",
            templateVersion: "1.2.3",
          }),
          downloadTemplate: async () => ({
            extractedDirectory,
            cleanup: async () => {
              throw new Error("cleanup failed");
            },
          }),
          stdout: stdout.stream,
          stderr: stderr.stream,
        },
      ),
    ).resolves.toBeUndefined();

    expect(await readFile(path.join(targetDirectory, "package.json"), "utf8")).toContain(
      '"name":"demo-app"',
    );
    expect(stderr.output).toBe("");
    expect(stdout.output).toBe(
      "bun install\n# set DATABASE_URL in .env\nbunx prisma migrate dev\nbun run dev\n",
    );
  });

  it("applies derived names through the default main flow", async () => {
    const workspaceRoot = await createTempDirectory("main-flow-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const cleanup = vi.fn(async () => undefined);
    const stdout = createBuffer();
    const stderr = createBuffer();

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: false });

    await runCreateApp(
      {
        directory: "demo-app",
        cwd: workspaceRoot,
        interactive: false,
      },
      {
        stdout: stdout.stream,
        stderr: stderr.stream,
        resolveRelease: async () => ({
          assetName: "starter-web-v1.2.3.tar.gz",
          downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          tagName: "v1.2.3",
          templateVersion: "1.2.3",
        }),
        downloadTemplate: async () => ({
          extractedDirectory,
          cleanup,
        }),
      },
    );

    expect(await readFile(path.join(targetDirectory, "package.json"), "utf8")).toContain(
      '"name":"demo-app"',
    );
    expect(await readFile(path.join(targetDirectory, "README.md"), "utf8")).toBe(
      "Demo App\n",
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(stderr.output).toBe("");
    expect(stdout.output).toBe(
      "bun install\n# set DATABASE_URL in .env\nbunx prisma migrate dev\nbun run dev\n",
    );
  });

  it("applies explicit package and app name overrides through the default main flow", async () => {
    const workspaceRoot = await createTempDirectory("main-flow-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: false });

    await runCreateApp(
      {
        directory: "demo-app",
        cwd: workspaceRoot,
        interactive: false,
        packageName: "@scope/custom-name",
        appName: "Custom Display Name",
      },
      {
        stdout: createBuffer().stream,
        stderr: createBuffer().stream,
        resolveRelease: async () => ({
          assetName: "starter-web-v1.2.3.tar.gz",
          downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          tagName: "v1.2.3",
          templateVersion: "1.2.3",
        }),
        downloadTemplate: async () => ({
          extractedDirectory,
          cleanup: async () => undefined,
        }),
      },
    );

    expect(await readFile(path.join(targetDirectory, "package.json"), "utf8")).toContain(
      '"name":"@scope/custom-name"',
    );
    expect(await readFile(path.join(targetDirectory, "README.md"), "utf8")).toBe(
      "Custom Display Name\n",
    );
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
      overwrite: false,
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
      overwrite: false,
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
      overwrite: false,
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
      overwrite: false,
    });
  });

  it("uses the implemented create flow when no explicit createApp override is provided", async () => {
    const workspaceRoot = await createTempDirectory("run-cli-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const stdout = createBuffer();
    const stderr = createBuffer();

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: false });

    const exitCode = await runCli(["demo-app"], {
      cwd: workspaceRoot,
      interactive: false,
      stdout: stdout.stream,
      stderr: stderr.stream,
      promptForDirectory: vi.fn(),
      resolveRelease: async () => ({
        assetName: "starter-web-v1.2.3.tar.gz",
        downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
        tagName: "v1.2.3",
        templateVersion: "1.2.3",
      }),
      downloadTemplate: async () => ({
        extractedDirectory,
        cleanup: async () => undefined,
      }),
    });

    expect(exitCode).toBe(0);
    expect(stderr.output).toBe("");
    expect(stdout.output).toBe(
      "bun install\n# set DATABASE_URL in .env\nbunx prisma migrate dev\nbun run dev\n",
    );
    expect(
      await readFile(path.join(workspaceRoot, "demo-app", "package.json"), "utf8"),
    ).toContain('"name":"demo-app"');
  });

  it("prints a plain error and exits cleanly when a non-interactive target directory is non-empty", async () => {
    const workspaceRoot = await createTempDirectory("run-cli-non-empty-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const stderr = createBuffer();

    await writeStarterTemplate(extractedDirectory, { defaultGitInit: false });
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(path.join(targetDirectory, "keep.txt"), "existing content\n");

    const exitCode = await runCli(["demo-app"], {
      cwd: workspaceRoot,
      interactive: false,
      stderr: stderr.stream,
      resolveRelease: async () => ({
        assetName: "starter-web-v1.2.3.tar.gz",
        downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
        tagName: "v1.2.3",
        templateVersion: "1.2.3",
      }),
      downloadTemplate: async () => ({
        extractedDirectory,
        cleanup: async () => undefined,
      }),
    });

    expect(exitCode).toBe(1);
    expect(stderr.output).toContain("Target directory");
    expect(stderr.output).not.toContain("at ensureTargetDirectoryState");
  });

  it("rethrows unexpected internal errors for diagnosability", async () => {
    await expect(
      runCli(["demo-app"], {
        cwd: "/workspace/current",
        interactive: false,
        createApp: async () => {
          throw new Error("unexpected boom");
        },
      }),
    ).rejects.toThrow("unexpected boom");
  });
});
