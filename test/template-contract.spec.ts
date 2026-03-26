import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import invalidFileListsFixture from "./fixtures/manifest-invalid-file-lists.json";
import invalidFlagsFixture from "./fixtures/manifest-invalid-flags.json";
import invalidTemplateVersionFixture from "./fixtures/manifest-invalid-template-version.json";
import invalidTokensFixture from "./fixtures/manifest-invalid-tokens.json";
import unsupportedFixture from "./fixtures/manifest-unsupported-schema.json";
import validFixture from "./fixtures/manifest-valid.json";
import { createPlancyApp } from "../src/main";
import {
  loadTemplateManifest,
  parseTemplateManifest,
  TEMPLATE_MANIFEST_SCHEMA_VERSION,
} from "../src/template-contract";

const temporaryDirectories = new Set<string>();

async function createExtractedDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "create-plancy-app-contract-"));

  temporaryDirectories.add(directory);

  return directory;
}

async function writeManifestFixture(
  extractedDirectory: string,
  fixture: unknown,
): Promise<void> {
  await writeFile(
    path.join(extractedDirectory, "starter.manifest.json"),
    JSON.stringify(fixture),
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
      temporaryDirectories.delete(directory);
    }),
  );
});

describe("template manifest contract", () => {
  it("valid schema version 1 parses successfully", () => {
    const manifest = parseTemplateManifest(validFixture);

    expect(manifest.schemaVersion).toBe(TEMPLATE_MANIFEST_SCHEMA_VERSION);
  });

  it("missing starter.manifest.json fails before target creation", async () => {
    const extractedDirectory = await createExtractedDirectory();
    const createTargetDirectory = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);

    await expect(
      createPlancyApp(
        {
          targetDirectory: "/workspace/demo-app",
          packageName: "demo-app",
          appName: "Demo App",
          skipGitInit: false,
        },
        {
          resolveRelease: vi.fn(async () => ({
            tagName: "v1.2.3",
            templateVersion: "1.2.3",
            assetName: "starter-web-v1.2.3.tar.gz",
            downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          })),
          downloadTemplate: vi.fn(async () => ({
            extractedDirectory,
            cleanup,
          })),
          createTargetDirectory,
        },
      ),
    ).rejects.toThrow(/starter\.manifest\.json/i);

    expect(createTargetDirectory).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("unsupported schemaVersion fails before target creation", async () => {
    const extractedDirectory = await createExtractedDirectory();
    const createTargetDirectory = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);

    await writeManifestFixture(extractedDirectory, unsupportedFixture);

    await expect(
      createPlancyApp(
        {
          targetDirectory: "/workspace/demo-app",
          packageName: "demo-app",
          appName: "Demo App",
          skipGitInit: false,
        },
        {
          resolveRelease: vi.fn(async () => ({
            tagName: "v1.2.3",
            templateVersion: "1.2.3",
            assetName: "starter-web-v1.2.3.tar.gz",
            downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          })),
          downloadTemplate: vi.fn(async () => ({
            extractedDirectory,
            cleanup,
          })),
          createTargetDirectory,
        },
      ),
    ).rejects.toThrow(/unsupported schema version/i);

    expect(createTargetDirectory).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("invalid templateVersion, token names, or token file lists fail before target creation", async () => {
    const fixtures = [
      invalidTemplateVersionFixture,
      invalidTokensFixture,
      invalidFileListsFixture,
    ];

    for (const fixture of fixtures) {
      const extractedDirectory = await createExtractedDirectory();
      const createTargetDirectory = vi.fn(async () => undefined);
      const cleanup = vi.fn(async () => undefined);

      await writeManifestFixture(extractedDirectory, fixture);

      await expect(
        createPlancyApp(
          {
            targetDirectory: "/workspace/demo-app",
            packageName: "demo-app",
            appName: "Demo App",
            skipGitInit: false,
          },
          {
            resolveRelease: vi.fn(async () => ({
              tagName: "v1.2.3",
              templateVersion: "1.2.3",
              assetName: "starter-web-v1.2.3.tar.gz",
              downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
            })),
            downloadTemplate: vi.fn(async () => ({
              extractedDirectory,
              cleanup,
            })),
            createTargetDirectory,
          },
        ),
      ).rejects.toThrow(/templateVersion|packageNameToken|appNameToken|Files/i);

      expect(createTargetDirectory).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledTimes(1);
    }
  });

  it("invalid copyEnvExampleToEnv or defaultGitInit values fail before target creation", async () => {
    const extractedDirectory = await createExtractedDirectory();
    const createTargetDirectory = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);

    await writeManifestFixture(extractedDirectory, invalidFlagsFixture);

    await expect(
      createPlancyApp(
        {
          targetDirectory: "/workspace/demo-app",
          packageName: "demo-app",
          appName: "Demo App",
          skipGitInit: false,
        },
        {
          resolveRelease: vi.fn(async () => ({
            tagName: "v1.2.3",
            templateVersion: "1.2.3",
            assetName: "starter-web-v1.2.3.tar.gz",
            downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          })),
          downloadTemplate: vi.fn(async () => ({
            extractedDirectory,
            cleanup,
          })),
          createTargetDirectory,
        },
      ),
    ).rejects.toThrow(/copyEnvExampleToEnv|defaultGitInit/i);

    expect(createTargetDirectory).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("archive-root contract failure is reported when the extracted temp directory does not contain the manifest at root", async () => {
    const extractedDirectory = await createExtractedDirectory();

    await mkdir(path.join(extractedDirectory, "starter-web"), { recursive: true });
    await writeFile(
      path.join(extractedDirectory, "starter-web", "starter.manifest.json"),
      JSON.stringify(validFixture),
      "utf8",
    );

    await expect(loadTemplateManifest(extractedDirectory)).rejects.toThrow(
      /starter\.manifest\.json.*root/i,
    );
  });

  it("manifest-listed files must exist before target creation", async () => {
    const extractedDirectory = await createExtractedDirectory();
    const createTargetDirectory = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);

    await writeManifestFixture(extractedDirectory, validFixture);

    await expect(
      createPlancyApp(
        {
          targetDirectory: "/workspace/demo-app",
          packageName: "demo-app",
          appName: "Demo App",
          skipGitInit: false,
        },
        {
          resolveRelease: vi.fn(async () => ({
            tagName: "v1.2.3",
            templateVersion: "1.2.3",
            assetName: "starter-web-v1.2.3.tar.gz",
            downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          })),
          downloadTemplate: vi.fn(async () => ({
            extractedDirectory,
            cleanup,
          })),
          createTargetDirectory,
        },
      ),
    ).rejects.toThrow(/manifest-listed file.*package\.json/i);

    expect(createTargetDirectory).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("manifest-listed files must be regular files under the extracted root", async () => {
    const extractedDirectory = await createExtractedDirectory();

    await writeManifestFixture(extractedDirectory, validFixture);
    await writeFile(path.join(extractedDirectory, "package.json"), "{}", "utf8");
    await mkdir(path.join(extractedDirectory, "app"), { recursive: true });
    await writeFile(
      path.join(extractedDirectory, "app", "app.config.ts"),
      "export default {}",
      "utf8",
    );

    const externalTarget = path.join(os.tmpdir(), "plancy-external-readme.txt");

    await writeFile(externalTarget, "outside", "utf8");
    await symlink(externalTarget, path.join(extractedDirectory, "README.md"));

    await expect(loadTemplateManifest(extractedDirectory)).rejects.toThrow(
      /manifest-listed file.*README\.md.*regular file/i,
    );
  });

  it("manifest templateVersion must match the resolved release version", async () => {
    const extractedDirectory = await createExtractedDirectory();
    const createTargetDirectory = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);

    await writeManifestFixture(extractedDirectory, {
      ...validFixture,
      templateVersion: "9.9.9",
    });
    await writeFile(path.join(extractedDirectory, "package.json"), "{}", "utf8");
    await writeFile(path.join(extractedDirectory, "README.md"), "# Demo", "utf8");
    await mkdir(path.join(extractedDirectory, "app"), { recursive: true });
    await writeFile(
      path.join(extractedDirectory, "app", "app.config.ts"),
      "export default {}",
      "utf8",
    );

    await expect(
      createPlancyApp(
        {
          targetDirectory: "/workspace/demo-app",
          packageName: "demo-app",
          appName: "Demo App",
          skipGitInit: false,
        },
        {
          resolveRelease: vi.fn(async () => ({
            tagName: "v1.2.3",
            templateVersion: "1.2.3",
            assetName: "starter-web-v1.2.3.tar.gz",
            downloadUrl: "https://example.com/starter-web-v1.2.3.tar.gz",
          })),
          downloadTemplate: vi.fn(async () => ({
            extractedDirectory,
            cleanup,
          })),
          createTargetDirectory,
        },
      ),
    ).rejects.toThrow(/templateVersion.*1\.2\.3.*9\.9\.9/i);

    expect(createTargetDirectory).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
