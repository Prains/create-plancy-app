#!/usr/bin/env bun

import process from "node:process";
import { InvalidArgumentsError, isCliError } from "./errors";
import { runCreateApp, type CreateAppDependencies } from "./main";

type ParsedCliArgs = {
  directory?: string;
  templateVersion?: string;
  packageName?: string;
  appName?: string;
  skipGitInit: boolean;
};

type WriteTarget = {
  write(chunk: string): boolean;
};

export type CliDependencies = CreateAppDependencies & {
  cwd?: string;
  interactive?: boolean;
  stderr?: WriteTarget;
  stdout?: WriteTarget;
};

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];

  if (!value) {
    throw new InvalidArgumentsError(`Missing value for ${flag}`);
  }

  return value;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    skipGitInit: false,
  };
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (positionalOnly || !argument.startsWith("--")) {
      if (parsed.directory) {
        throw new InvalidArgumentsError("Only one target directory can be provided");
      }

      parsed.directory = argument;
      continue;
    }

    if (argument === "--") {
      positionalOnly = true;
      continue;
    }

    if (argument === "--skip-git-init") {
      parsed.skipGitInit = true;
      continue;
    }

    if (argument === "--template-version") {
      parsed.templateVersion = requireValue(argv, index + 1, argument);
      index += 1;
      continue;
    }

    if (argument === "--package-name") {
      parsed.packageName = requireValue(argv, index + 1, argument);
      index += 1;
      continue;
    }

    if (argument === "--app-name") {
      parsed.appName = requireValue(argv, index + 1, argument);
      index += 1;
      continue;
    }

    throw new InvalidArgumentsError(`Unknown option: ${argument}`);
  }

  return parsed;
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stderr = dependencies.stderr ?? process.stderr;

  try {
    const parsed = parseCliArgs(argv);

    await runCreateApp(
      {
        ...parsed,
        cwd: dependencies.cwd ?? process.cwd(),
        interactive: dependencies.interactive ?? Boolean(process.stdin.isTTY),
      },
      dependencies,
    );

    return 0;
  } catch (error) {
    if (!isCliError(error)) {
      throw error;
    }

    stderr.write(`${error.message}\n`);

    return error.exitCode;
  }
}

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2));

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
