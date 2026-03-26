import os from "node:os";
import path from "node:path";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeProject } from "../src/project-writer";
import {
  APP_NAME_TOKEN,
  PACKAGE_NAME_TOKEN,
  type TemplateManifest,
} from "../src/template-contract";

const tempDirectories: string[] = [];

function createManifest(
  overrides: Partial<TemplateManifest> = {},
): TemplateManifest {
  return {
    schemaVersion: 1,
    templateVersion: "1.2.3",
    packageNameToken: PACKAGE_NAME_TOKEN,
    appNameToken: APP_NAME_TOKEN,
    packageNameFiles: ["package.json"],
    appNameFiles: ["README.md", "src/app.txt"],
    copyEnvExampleToEnv: true,
    defaultGitInit: true,
    ...overrides,
  };
}

async function createTempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

async function writeTemplateFiles(
  rootDirectory: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const absolutePath = path.join(rootDirectory, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, contents);
    }),
  );
}

async function listEntries(rootDirectory: string): Promise<string[]> {
  return (await readdir(rootDirectory)).sort();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("writeProject", () => {
  it("hard-fails before copy when the target directory is non-empty", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    const copyDirectory = vi.fn(async () => undefined);

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
      "src/app.txt": `${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=\n",
    });
    await writeTemplateFiles(targetDirectory, {
      "keep.txt": "existing content\n",
    });

    await expect(
      writeProject({
        extractedDirectory,
        targetDirectory,
        manifest: createManifest(),
        packageName: "demo-app",
        appName: "Demo App",
      }, { copyDirectory }),
    ).rejects.toThrow(/Target directory .* must be empty before scaffolding/i);

    expect(copyDirectory).not.toHaveBeenCalled();
    expect(await readFile(path.join(targetDirectory, "keep.txt"), "utf8")).toBe(
      "existing content\n",
    );
    expect(await listEntries(workspaceRoot)).toEqual(["demo-app", "starter"]);
  });

  it("skips .env creation cleanly when copyEnvExampleToEnv is false", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
      "src/app.txt": `${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=file:dev.db\n",
    });

    await writeProject({
      extractedDirectory,
      targetDirectory,
      manifest: createManifest({ copyEnvExampleToEnv: false }),
      packageName: "demo-app",
      appName: "Demo App",
    });

    expect(await pathExists(path.join(targetDirectory, ".env"))).toBe(false);
  });

  it("hard-fails before mutation when a manifest-listed file is missing after copy", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
    });

    await expect(
      writeProject({
        extractedDirectory,
        targetDirectory,
        manifest: createManifest(),
        packageName: "demo-app",
        appName: "Demo App",
      }),
    ).rejects.toThrow(/Manifest-listed file src\/app\.txt does not exist/i);

    expect(await pathExists(targetDirectory)).toBe(false);
  });

  it("replaces the package-name token in package.json", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}","displayName":"${APP_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
      "src/app.txt": `${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=file:dev.db\n",
    });

    await writeProject({
      extractedDirectory,
      targetDirectory,
      manifest: createManifest({ appNameFiles: ["package.json", "README.md", "src/app.txt"] }),
      packageName: "@scope/demo-app",
      appName: "Demo App",
    });

    const packageJson = await readFile(path.join(targetDirectory, "package.json"), "utf8");

    expect(packageJson).toContain(`"name":"@scope/demo-app"`);
    expect(packageJson).not.toContain(PACKAGE_NAME_TOKEN);
  });

  it("replaces the app-name token in every manifest-listed file", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `# ${APP_NAME_TOKEN}\n`,
      "src/app.txt": `Welcome to ${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=file:dev.db\n",
    });

    await writeProject({
      extractedDirectory,
      targetDirectory,
      manifest: createManifest(),
      packageName: "demo-app",
      appName: "Demo App",
    });

    for (const relativePath of createManifest().appNameFiles) {
      const fileContents = await readFile(path.join(targetDirectory, relativePath), "utf8");
      expect(fileContents).toContain("Demo App");
      expect(fileContents).not.toContain(APP_NAME_TOKEN);
    }
  });

  it("copies .env.example to .env when requested by the manifest", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
      "src/app.txt": `${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=file:dev.db\nBETTER_AUTH_SECRET=secret\n",
    });

    await writeProject({
      extractedDirectory,
      targetDirectory,
      manifest: createManifest(),
      packageName: "demo-app",
      appName: "Demo App",
    });

    expect(await readFile(path.join(targetDirectory, ".env"), "utf8")).toBe(
      "DATABASE_URL=file:dev.db\nBETTER_AUTH_SECRET=secret\n",
    );
  });

  it("cleans up the staging directory and leaves the target untouched when copy fails", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
      "src/app.txt": `${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=file:dev.db\n",
    });

    await expect(
      writeProject(
        {
          extractedDirectory,
          targetDirectory,
          manifest: createManifest(),
          packageName: "demo-app",
          appName: "Demo App",
        },
        {
          copyDirectory: async () => {
            throw new Error("copy failed");
          },
        },
      ),
    ).rejects.toThrow("copy failed");

    expect(await pathExists(targetDirectory)).toBe(false);
    expect(await listEntries(workspaceRoot)).toEqual(["starter"]);
  });

  it("cleans up the staging directory and leaves an existing empty target untouched when substitution fails", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
      "src/app.txt": `${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=file:dev.db\n",
    });
    await mkdir(targetDirectory, { recursive: true });

    await expect(
      writeProject(
        {
          extractedDirectory,
          targetDirectory,
          manifest: createManifest(),
          packageName: "demo-app",
          appName: "Demo App",
        },
        {
          writeFile: async () => {
            throw new Error("substitution failed");
          },
        },
      ),
    ).rejects.toThrow("substitution failed");

    expect(await listEntries(targetDirectory)).toEqual([]);
    expect(await listEntries(workspaceRoot)).toEqual(["demo-app", "starter"]);
  });

  it("publishes successfully into an existing empty target directory", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
      "src/app.txt": `${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=file:dev.db\n",
    });
    await mkdir(targetDirectory, { recursive: true });

    await writeProject({
      extractedDirectory,
      targetDirectory,
      manifest: createManifest(),
      packageName: "demo-app",
      appName: "Demo App",
    });

    expect(await readFile(path.join(targetDirectory, "package.json"), "utf8")).toContain(
      '"name":"demo-app"',
    );
    expect(await readFile(path.join(targetDirectory, "README.md"), "utf8")).toBe(
      "Demo App\n",
    );
  });

  it("ignores backup cleanup errors after a successful existing-empty-target publish", async () => {
    const workspaceRoot = await createTempDirectory("project-writer-");
    const extractedDirectory = path.join(workspaceRoot, "starter");
    const targetDirectory = path.join(workspaceRoot, "demo-app");
    let backupDirectory = "";

    await writeTemplateFiles(extractedDirectory, {
      "package.json": `{"name":"${PACKAGE_NAME_TOKEN}"}`,
      "README.md": `${APP_NAME_TOKEN}\n`,
      "src/app.txt": `${APP_NAME_TOKEN}\n`,
      ".env.example": "DATABASE_URL=file:dev.db\n",
    });
    await mkdir(targetDirectory, { recursive: true });

    await writeProject(
      {
        extractedDirectory,
        targetDirectory,
        manifest: createManifest(),
        packageName: "demo-app",
        appName: "Demo App",
      },
      {
        rename: async (sourcePath, destinationPath) => {
          if (sourcePath === targetDirectory) {
            backupDirectory = destinationPath;
          }

          await rename(sourcePath, destinationPath);
        },
        removeDirectory: async (directoryPath) => {
          if (directoryPath === backupDirectory) {
            throw new Error("backup cleanup failed");
          }

          await rm(directoryPath, { recursive: true, force: true });
        },
      },
    );

    expect(await readFile(path.join(targetDirectory, "package.json"), "utf8")).toContain(
      '"name":"demo-app"',
    );
  });
});
