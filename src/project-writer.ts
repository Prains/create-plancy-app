import path from "node:path";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile as writeFileImpl,
} from "node:fs/promises";
import type { TemplateManifest } from "./template-contract";

export type WriteProjectInput = {
  extractedDirectory: string;
  targetDirectory: string;
  manifest: TemplateManifest;
  packageName: string;
  appName: string;
  overwrite?: boolean;
};

type TargetDirectoryMode = "missing" | "existing-empty" | "existing-non-empty";

type CopyDirectory = (
  sourcePath: string,
  destinationPath: string,
) => Promise<void>;

type RemoveDirectory = (directoryPath: string) => Promise<void>;
type WriteFile = (filePath: string, contents: string) => Promise<void>;

export type WriteProjectDependencies = {
  copyDirectory?: CopyDirectory;
  removeDirectory?: RemoveDirectory;
  rename?: (sourcePath: string, destinationPath: string) => Promise<void>;
  writeFile?: WriteFile;
};

function createStagingPrefix(targetDirectory: string): string {
  const resolvedTargetDirectory = path.resolve(targetDirectory);

  return path.join(
    path.dirname(resolvedTargetDirectory),
    `.${path.basename(resolvedTargetDirectory)}.staging-`,
  );
}

async function defaultCopyDirectory(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await cp(sourcePath, destinationPath, {
    recursive: true,
    force: true,
  });
}

async function defaultWriteFile(
  filePath: string,
  contents: string,
): Promise<void> {
  await writeFileImpl(filePath, contents, "utf8");
}

async function defaultRemoveDirectory(directoryPath: string): Promise<void> {
  await rm(directoryPath, {
    recursive: true,
    force: true,
  });
}

async function ensureTargetDirectoryState(
  targetDirectory: string,
): Promise<TargetDirectoryMode> {
  try {
    const stats = await lstat(targetDirectory);

    if (!stats.isDirectory()) {
      throw new Error(
        `Target path ${targetDirectory} already exists and is not a directory`,
      );
    }

    const existingEntries = await readdir(targetDirectory);

    return existingEntries.length > 0 ? "existing-non-empty" : "existing-empty";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }

    throw error;
  }
}

async function assertTargetDirectoryStillEmpty(
  targetDirectory: string,
): Promise<void> {
  const existingEntries = await readdir(targetDirectory);

  if (existingEntries.length > 0) {
    throw new Error(
      `Target directory ${targetDirectory} must remain empty before scaffolding`,
    );
  }
}

async function copyDirectoryContents(
  sourceDirectory: string,
  destinationDirectory: string,
  copyDirectory: CopyDirectory,
): Promise<string[]> {
  const entries = await readdir(sourceDirectory);

  for (const entry of entries) {
    await copyDirectory(
      path.join(sourceDirectory, entry),
      path.join(destinationDirectory, entry),
    );
  }

  return entries;
}

async function assertManifestListedFile(
  projectDirectory: string,
  relativePath: string,
): Promise<void> {
  const absolutePath = path.resolve(projectDirectory, relativePath);
  const relativeToRoot = path.relative(projectDirectory, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(
      `Manifest-listed file ${relativePath} must stay within the project root`,
    );
  }

  let stats;

  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Manifest-listed file ${relativePath} does not exist`);
    }

    throw error;
  }

  if (!stats.isFile()) {
    throw new Error(
      `Manifest-listed file ${relativePath} must be a regular file`,
    );
  }
}

async function verifyManifestListedFiles(
  projectDirectory: string,
  manifest: TemplateManifest,
): Promise<void> {
  const listedFiles = new Set([
    ...manifest.packageNameFiles,
    ...manifest.appNameFiles,
  ]);

  for (const relativePath of listedFiles) {
    await assertManifestListedFile(projectDirectory, relativePath);
  }
}

function replaceToken(
  contents: string,
  token: string,
  replacement: string,
): string {
  return contents.split(token).join(replacement);
}

async function writeFileAtomically(
  filePath: string,
  contents: string,
  writeFile: WriteFile,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.tmp`,
  );

  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function applyManifestTokenSubstitutions(
  projectDirectory: string,
  manifest: TemplateManifest,
  packageName: string,
  appName: string,
  writeFile: WriteFile,
): Promise<void> {
  const packageNameFiles = new Set(manifest.packageNameFiles);
  const appNameFiles = new Set(manifest.appNameFiles);
  const listedFiles = new Set([...packageNameFiles, ...appNameFiles]);

  for (const relativePath of listedFiles) {
    const absolutePath = path.join(projectDirectory, relativePath);
    let contents = await readFile(absolutePath, "utf8");

    if (packageNameFiles.has(relativePath)) {
      contents = replaceToken(contents, manifest.packageNameToken, packageName);
    }

    if (appNameFiles.has(relativePath)) {
      contents = replaceToken(contents, manifest.appNameToken, appName);
    }

    await writeFileAtomically(absolutePath, contents, writeFile);
  }
}

async function copyEnvExampleToEnv(
  projectDirectory: string,
  writeFile: WriteFile,
): Promise<void> {
  const envExamplePath = path.join(projectDirectory, ".env.example");
  let envContents: string;

  try {
    envContents = await readFile(envExamplePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "Manifest requires .env.example to exist at the starter root",
      );
    }

    throw error;
  }

  await writeFileAtomically(path.join(projectDirectory, ".env"), envContents, writeFile);
}

export async function writeProject(
  input: WriteProjectInput,
  dependencies: WriteProjectDependencies = {},
): Promise<void> {
  const copyDirectory = dependencies.copyDirectory ?? defaultCopyDirectory;
  const removeDirectory = dependencies.removeDirectory ?? defaultRemoveDirectory;
  const renamePath = dependencies.rename ?? rename;
  const writeFile = dependencies.writeFile ?? defaultWriteFile;
  const targetMode = await ensureTargetDirectoryState(input.targetDirectory);
  const targetParentDirectory = path.dirname(path.resolve(input.targetDirectory));

  if (targetMode === "existing-non-empty" && !input.overwrite) {
    throw new Error(
      `Target directory ${input.targetDirectory} must be empty before scaffolding`,
    );
  }

  await mkdir(targetParentDirectory, { recursive: true });

  const stagingDirectory = await mkdtemp(createStagingPrefix(input.targetDirectory));

  try {
    await copyDirectoryContents(
      input.extractedDirectory,
      stagingDirectory,
      copyDirectory,
    );
    await verifyManifestListedFiles(stagingDirectory, input.manifest);
    await applyManifestTokenSubstitutions(
      stagingDirectory,
      input.manifest,
      input.packageName,
      input.appName,
      writeFile,
    );

    if (input.manifest.copyEnvExampleToEnv) {
      await copyEnvExampleToEnv(stagingDirectory, writeFile);
    }

    if (targetMode === "missing") {
      await renamePath(stagingDirectory, input.targetDirectory);
      return;
    }

    if (targetMode === "existing-empty" && !input.overwrite) {
      await assertTargetDirectoryStillEmpty(input.targetDirectory);
    }

    const backupDirectory = await mkdtemp(
      path.join(
        targetParentDirectory,
        `.${path.basename(path.resolve(input.targetDirectory))}.backup-`,
      ),
    );

    await removeDirectory(backupDirectory);

    try {
      await renamePath(input.targetDirectory, backupDirectory);
      await renamePath(stagingDirectory, input.targetDirectory);
    } catch (error) {
      try {
        await renamePath(backupDirectory, input.targetDirectory);
      } catch {
        // Preserve the original publish error; rollback is best-effort here.
      }

      throw error;
    }

    try {
      await removeDirectory(backupDirectory);
    } catch {
      // The project is already published successfully. Ignore backup cleanup failures.
    }
  } catch (error) {
    await removeDirectory(stagingDirectory);
    throw error;
  }

  try {
    await removeDirectory(stagingDirectory);
  } catch {
    // Best-effort staging cleanup after a successful publish.
  }
}
