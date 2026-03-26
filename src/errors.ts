export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

export class InvalidArgumentsError extends CliError {}

export class UnimplementedCliError extends CliError {}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}
