import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import readline from "node:readline/promises";
import process from "node:process";
import {
  downloadTemplateArchive,
  type DownloadedTemplateArchive,
} from "./download-template";
import { CliError, InvalidArgumentsError } from "./errors";
import { tryInitGit, type TryInitGitResult } from "./git";
import { deriveAppName, derivePackageName } from "./name-derivation";
import { writeProject, type WriteProjectInput } from "./project-writer";
import {
  resolveTemplateRelease,
  type ResolvedTemplateRelease,
} from "./release-source";
import {
  loadTemplateManifest,
  type TemplateManifest,
} from "./template-contract";
import { createTerminalUI } from "./terminal-ui";

export type CreateAppInput = {
  targetDirectory: string;
  templateVersion?: string;
  packageName?: string;
  appName?: string;
  skipGitInit: boolean;
  overwrite?: boolean;
};

export type WriteTarget = {
  write(chunk: string): boolean;
  isTTY?: boolean;
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

export type CreatePlancyAppDependencies = {
  downloadTemplate?: (
    release: ResolvedTemplateRelease,
  ) => Promise<DownloadedTemplateArchive>;
  resolveRelease?: (
    templateVersion?: string,
  ) => Promise<ResolvedTemplateRelease>;
  stderr?: WriteTarget;
  stdout?: WriteTarget;
  tryInitGit?: (directory: string) => Promise<TryInitGitResult>;
  writeProject?: (input: WriteProjectInput) => Promise<void>;
};

export type CreateAppDependencies = CreatePlancyAppDependencies & {
  promptForDirectory?: () => Promise<string>;
  promptForOverwrite?: (targetDirectory: string) => Promise<boolean>;
  createApp?: (input: CreateAppInput) => Promise<void>;
};

export const USAGE_MESSAGE = "Usage: bun create plancy-app <directory>";
export const SUCCESS_NEXT_STEPS_BLOCK =
  "bun install\n# set DATABASE_URL in .env\nbunx prisma migrate dev\nbun run dev\n";

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

async function promptForOverwriteFromStdin(
  targetDirectory: string,
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (
      await rl.question(
        `Directory ${targetDirectory} is not empty. Overwrite it? [y/N] `,
      )
    )
      .trim()
      .toLowerCase();

    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function isNonEmptyDirectory(targetDirectory: string): Promise<boolean> {
  try {
    const stats = await lstat(targetDirectory);

    if (!stats.isDirectory()) {
      throw new Error(
        `Target path ${targetDirectory} already exists and is not a directory`,
      );
    }

    return (await readdir(targetDirectory)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
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
): Promise<void> {
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
  const writeProjectToDisk = dependencies.writeProject ?? writeProject;
  const tryInitGitInDirectory = dependencies.tryInitGit ?? tryInitGit;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const terminalUI = createTerminalUI(stdout);

  const release = await terminalUI.withStep(
    "Resolving starter release",
    () => resolveRelease(input.templateVersion),
  );
  const downloadedTemplate = await terminalUI.withStep(
    "Downloading starter template",
    () => downloadTemplate(release),
  );
  let cleanedUp = false;

  async function cleanupDownloadedTemplate(): Promise<void> {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await downloadedTemplate.cleanup();
  }

  try {
    const manifest = await terminalUI.withStep("Validating starter manifest", async () => {
      const loadedManifest = await loadTemplateManifest(
        downloadedTemplate.extractedDirectory,
      );

      assertTemplateVersionsMatch(release, loadedManifest);

      return loadedManifest;
    });

    await terminalUI.withStep("Writing project files", () =>
      writeProjectToDisk({
        extractedDirectory: downloadedTemplate.extractedDirectory,
        targetDirectory: input.targetDirectory,
        manifest,
        packageName: input.packageName ?? derivePackageName(input.targetDirectory),
        appName:
          input.appName ??
          deriveAppName(
            input.packageName ?? derivePackageName(input.targetDirectory),
          ),
        overwrite: input.overwrite ?? false,
      }),
    );

    if (!input.skipGitInit && manifest.defaultGitInit) {
      const gitResult = await terminalUI.withStep(
        "Initializing git repository",
        () => tryInitGitInDirectory(input.targetDirectory),
        {
          getCompletion: (result) => (result.ok ? "ok" : "warning"),
        },
      );

      if (!gitResult.ok) {
        stderr.write(`Warning: ${gitResult.error}\n`);
      }
    }

    terminalUI.printSuccess(input.targetDirectory, SUCCESS_NEXT_STEPS_BLOCK);
  } catch (error) {
    try {
      await cleanupDownloadedTemplate();
    } catch {
      // Preserve the original scaffolding error.
    }

    throw error;
  }

  try {
    await cleanupDownloadedTemplate();
  } catch {
    // The project is already scaffolded successfully. Ignore temp cleanup failures.
  }
}

export async function runCreateApp(
  options: RunCreateAppOptions,
  dependencies: CreateAppDependencies = {},
): Promise<void> {
  const promptForDirectory =
    dependencies.promptForDirectory ?? promptForDirectoryFromStdin;
  const promptForOverwrite =
    dependencies.promptForOverwrite ?? promptForOverwriteFromStdin;
  const createApp =
    dependencies.createApp ?? ((input: CreateAppInput) => createPlancyApp(input, dependencies));

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
  const hasExistingContents = await isNonEmptyDirectory(targetDirectory);
  let overwrite = false;

  if (hasExistingContents) {
    if (!options.interactive) {
      throw new Error(
        `Target directory ${targetDirectory} must be empty before scaffolding`,
      );
    }

    overwrite = await promptForOverwrite(targetDirectory);

    if (!overwrite) {
      throw new CliError("Canceled scaffolding.");
    }
  }

  const packageName = derivePackageName(targetDirectory, options.packageName);
  const appName = deriveAppName(packageName, options.appName);

  await createApp({
    targetDirectory,
    packageName,
    appName,
    templateVersion: options.templateVersion,
    skipGitInit: options.skipGitInit ?? false,
    overwrite,
  });
}
