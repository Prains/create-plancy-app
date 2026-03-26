import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";
import {
  downloadTemplateArchive,
  type DownloadedTemplateArchive,
} from "./download-template";
import { InvalidArgumentsError, UnimplementedCliError } from "./errors";
import { deriveAppName, derivePackageName } from "./name-derivation";
import {
  resolveTemplateRelease,
  type ResolvedTemplateRelease,
} from "./release-source";
import {
  loadTemplateManifest,
  type TemplateManifest,
} from "./template-contract";

export type CreateAppInput = {
  targetDirectory: string;
  templateVersion?: string;
  packageName?: string;
  appName?: string;
  skipGitInit: boolean;
};

export type RunCreateAppOptions = {
  directory?: string;
  cwd: string;
  interactive: boolean;
  templateVersion?: string;
  packageName?: string;
  appName?: string;
  skipGitInit?: boolean;
};

export type CreateAppDependencies = {
  promptForDirectory?: () => Promise<string>;
  createApp?: (input: CreateAppInput) => Promise<void>;
};

export type CreatePlancyAppDependencies = {
  createTargetDirectory?: (targetDirectory: string) => Promise<void>;
  downloadTemplate?: (
    release: ResolvedTemplateRelease,
  ) => Promise<DownloadedTemplateArchive>;
  resolveRelease?: (
    templateVersion?: string,
  ) => Promise<ResolvedTemplateRelease>;
};

export type PreparedTemplate = {
  cleanup: () => Promise<void>;
  extractedDirectory: string;
  manifest: TemplateManifest;
  release: ResolvedTemplateRelease;
};

export const USAGE_MESSAGE = "Usage: bun create plancy-app <directory>";
export const UNIMPLEMENTED_CREATE_FLOW_MESSAGE =
  "CLI create flow is not implemented yet.";

function assertTemplateVersionsMatch(
  release: ResolvedTemplateRelease,
  manifest: TemplateManifest,
): void {
  if (release.templateVersion !== manifest.templateVersion) {
    throw new Error(
      `templateVersion mismatch: resolved release ${release.templateVersion} vs starter.manifest.json ${manifest.templateVersion}`,
    );
  }
}

async function promptForDirectoryFromStdin(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (await rl.question("Where should Plancy be created? ")).trim();
  } finally {
    rl.close();
  }
}

function resolveTargetDirectory(directory: string, cwd: string): string {
  if (directory === ".") {
    return cwd;
  }

  return path.resolve(cwd, directory);
}

export async function createPlancyApp(
  input: CreateAppInput,
  dependencies: CreatePlancyAppDependencies = {},
): Promise<PreparedTemplate> {
  const resolveRelease =
    dependencies.resolveRelease ??
    ((templateVersion?: string) => resolveTemplateRelease({ templateVersion }));
  const downloadTemplate =
    dependencies.downloadTemplate ??
    ((release: ResolvedTemplateRelease) =>
      downloadTemplateArchive({
        assetName: release.assetName,
        downloadUrl: release.downloadUrl,
      }));
  const createTargetDirectory =
    dependencies.createTargetDirectory ??
    (async () => {
      throw new UnimplementedCliError(UNIMPLEMENTED_CREATE_FLOW_MESSAGE);
    });

  const release = await resolveRelease(input.templateVersion);
  const downloadedTemplate = await downloadTemplate(release);

  try {
    const manifest = await loadTemplateManifest(downloadedTemplate.extractedDirectory);

    assertTemplateVersionsMatch(release, manifest);

    await createTargetDirectory(input.targetDirectory);

    return {
      release,
      manifest,
      extractedDirectory: downloadedTemplate.extractedDirectory,
      cleanup: downloadedTemplate.cleanup,
    };
  } catch (error) {
    await downloadedTemplate.cleanup();
    throw error;
  }
}

export async function runCreateApp(
  options: RunCreateAppOptions,
  dependencies: CreateAppDependencies = {},
): Promise<void> {
  const promptForDirectory =
    dependencies.promptForDirectory ?? promptForDirectoryFromStdin;
  const createApp =
    dependencies.createApp ??
    (async () => {
      throw new UnimplementedCliError(UNIMPLEMENTED_CREATE_FLOW_MESSAGE);
    });

  let directory = options.directory;

  if (!directory) {
    if (!options.interactive) {
      throw new InvalidArgumentsError(USAGE_MESSAGE);
    }

    directory = (await promptForDirectory()).trim();

    if (!directory) {
      throw new InvalidArgumentsError(USAGE_MESSAGE);
    }
  }

  const targetDirectory = resolveTargetDirectory(directory, options.cwd);
  const packageName = derivePackageName(targetDirectory, options.packageName);
  const appName = deriveAppName(packageName, options.appName);

  await createApp({
    targetDirectory,
    packageName,
    appName,
    templateVersion: options.templateVersion,
    skipGitInit: options.skipGitInit ?? false,
  });
}
