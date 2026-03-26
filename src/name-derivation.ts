import path from "node:path";
import validatePackageName from "validate-npm-package-name";
import { InvalidArgumentsError } from "./errors";

function formatInvalidNameMessage(
  source: string,
  sanitized: string,
  reason?: string,
): string {
  const suffix = reason ? ` ${reason}` : "";

  if (!sanitized) {
    return `Could not derive a valid npm package name from "${source}".`;
  }

  if (sanitized === source) {
    return `Could not use "${source}" as a valid npm package name.${suffix}`;
  }

  return `Could not derive a valid npm package name from "${source}" (sanitized to "${sanitized}").${suffix}`;
}

function sanitizePackageName(candidate: string): string {
  return candidate
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function toDirectoryBasename(targetDirectory: string): string {
  const resolvedPath = path.resolve(targetDirectory);

  return path.basename(resolvedPath).toLowerCase();
}

function validateOrThrow(candidate: string, source: string): string {
  const validation = validatePackageName(candidate);

  if (!validation.validForNewPackages) {
    const reason = validation.errors?.[0] ?? validation.warnings?.[0];

    throw new InvalidArgumentsError(
      formatInvalidNameMessage(source, candidate, reason),
    );
  }

  return candidate;
}

export function derivePackageName(
  targetDirectory: string,
  override?: string,
): string {
  if (override) {
    return validateOrThrow(override, override);
  }

  const source = toDirectoryBasename(targetDirectory);
  const sanitized = sanitizePackageName(source);

  if (!sanitized) {
    throw new InvalidArgumentsError(formatInvalidNameMessage(source, sanitized));
  }

  return validateOrThrow(sanitized, source);
}

function titleCaseSegment(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function normalizePackageNameForDisplay(packageName: string): string {
  if (packageName.startsWith("@")) {
    const [, scopedName] = packageName.split("/", 2);

    return scopedName ?? packageName;
  }

  return packageName;
}

export function deriveAppName(packageName: string, override?: string): string {
  if (override) {
    return override;
  }

  return normalizePackageNameForDisplay(packageName)
    .split(/[-._/]+/)
    .filter((segment) => segment.length > 0)
    .map(titleCaseSegment)
    .join(" ");
}
