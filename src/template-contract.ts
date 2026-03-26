import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const TEMPLATE_MANIFEST_FILE_NAME = "starter.manifest.json";
export const TEMPLATE_MANIFEST_SCHEMA_VERSION = 1;
export const PACKAGE_NAME_TOKEN = "__PACKAGE_NAME__";
export const APP_NAME_TOKEN = "__APP_NAME__";

function isValidTemplateVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function isValidTemplateFilePath(value: string): boolean {
  if (value.length === 0 || value.trim() !== value) {
    return false;
  }

  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return false;
  }

  return value
    .split(/[\\/]/)
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

const templateFilePathSchema = z.string().refine(isValidTemplateFilePath, {
  message: "must be a non-empty relative file path",
});

export const templateManifestSchema = z
  .object({
    schemaVersion: z.number().int(),
    templateVersion: z.string().refine(isValidTemplateVersion, {
      message: "must be a semantic version like 1.2.3",
    }),
    packageNameToken: z.literal(PACKAGE_NAME_TOKEN),
    appNameToken: z.literal(APP_NAME_TOKEN),
    packageNameFiles: z.array(templateFilePathSchema).min(1),
    appNameFiles: z.array(templateFilePathSchema).min(1),
    copyEnvExampleToEnv: z.boolean(),
    defaultGitInit: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.schemaVersion !== TEMPLATE_MANIFEST_SCHEMA_VERSION) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schemaVersion"],
        message: `Unsupported schema version: ${value.schemaVersion}`,
      });
    }
  });

export type TemplateManifest = z.infer<typeof templateManifestSchema>;

function formatManifestIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "manifest";

      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
}

export function parseTemplateManifest(input: unknown): TemplateManifest {
  const result = templateManifestSchema.safeParse(input);

  if (!result.success) {
    throw new Error(
      `Invalid template manifest: ${formatManifestIssues(result.error.issues)}`,
    );
  }

  return result.data;
}

async function assertManifestListedFile(
  extractedDirectory: string,
  relativePath: string,
): Promise<void> {
  const absolutePath = path.resolve(extractedDirectory, relativePath);
  const relativeToRoot = path.relative(extractedDirectory, absolutePath);

  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error(
      `Manifest-listed file ${relativePath} must stay within the extracted root`,
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

async function validateManifestListedFiles(
  extractedDirectory: string,
  manifest: TemplateManifest,
): Promise<void> {
  const listedFiles = new Set([
    ...manifest.packageNameFiles,
    ...manifest.appNameFiles,
  ]);

  await Promise.all(
    [...listedFiles].map((relativePath) =>
      assertManifestListedFile(extractedDirectory, relativePath),
    ),
  );
}

export async function loadTemplateManifest(
  extractedDirectory: string,
): Promise<TemplateManifest> {
  const manifestPath = path.join(extractedDirectory, TEMPLATE_MANIFEST_FILE_NAME);
  let manifestContents: string;

  try {
    manifestContents = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Extracted starter archive must contain ${TEMPLATE_MANIFEST_FILE_NAME} at the extracted root`,
      );
    }

    throw error;
  }

  try {
    const manifest = parseTemplateManifest(JSON.parse(manifestContents) as unknown);

    await validateManifestListedFiles(extractedDirectory, manifest);

    return manifest;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${TEMPLATE_MANIFEST_FILE_NAME}`);
    }

    throw error;
  }
}
