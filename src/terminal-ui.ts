import { sanitizeTerminalText } from "./terminal-text";

type WriteTarget = {
  write(chunk: string): boolean;
  isTTY?: boolean;
};

const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const ANSI_RESET = "\u001B[0m";
const ANSI_BOLD = "\u001B[1m";
const ANSI_CYAN = "\u001B[36m";
const ANSI_DIM = "\u001B[2m";
const ANSI_GREEN = "\u001B[32m";
const ANSI_RED = "\u001B[31m";
const ANSI_YELLOW = "\u001B[33m";

type StepCompletion = "ok" | "warning";

type StepOptions<T> = {
  getCompletion?: (result: T) => StepCompletion;
};

function colorize(enabled: boolean, color: string, text: string): string {
  return enabled ? `${color}${text}${ANSI_RESET}` : text;
}

function measureTextWidth(text: string): number {
  return text.replace(/\u001B\[[0-9;]*m/g, "").length;
}

function renderBox(lines: string[]): string {
  const width = lines.reduce(
    (currentWidth, line) => Math.max(currentWidth, measureTextWidth(line)),
    0,
  );
  const border = `+${"-".repeat(width + 2)}+`;

  return [
    border,
    ...lines.map((line) => {
      const padding = " ".repeat(width - measureTextWidth(line));

      return `| ${line}${padding} |`;
    }),
    border,
  ].join("\n");
}

export function createTerminalUI(stdout: WriteTarget) {
  const isTTY = stdout.isTTY === true;
  let printedHeader = false;

  function renderStepResult(
    completion: StepCompletion,
    label: string,
  ): void {
    const renderedBadge =
      completion === "warning"
        ? colorize(true, ANSI_YELLOW, "[!]")
        : colorize(true, ANSI_GREEN, "[ok]");

    stdout.write(`\r\u001B[2K${renderedBadge} ${label}\n`);
  }

  function writeHeader(): void {
    if (!isTTY || printedHeader) {
      return;
    }

    printedHeader = true;
    stdout.write(
      `${colorize(true, ANSI_BOLD + ANSI_CYAN, "create-plancy-app")}\n` +
      `${colorize(true, ANSI_DIM, "Scaffold a Plancy starter with live backend wiring.")}\n\n`,
    );
  }

  async function withStep<T>(
    label: string,
    run: () => Promise<T>,
    options: StepOptions<T> = {},
  ): Promise<T> {
    if (!isTTY) {
      return await run();
    }

    writeHeader();

    let frameIndex = 0;
    const renderFrame = () => {
      const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
      frameIndex += 1;
      stdout.write(
        `\r\u001B[2K${colorize(true, ANSI_CYAN, frame)} ${colorize(true, ANSI_DIM, label)}`,
      );
    };

    renderFrame();

    const interval = setInterval(renderFrame, 80);
    interval.unref?.();

    try {
      const result = await run();
      clearInterval(interval);
      renderStepResult(options.getCompletion?.(result) ?? "ok", label);
      return result;
    } catch (error) {
      clearInterval(interval);
      stdout.write(`\r\u001B[2K${colorize(true, ANSI_RED, "[x]")} ${label}\n`);
      throw error;
    }
  }

  function printSuccess(targetDirectory: string, nextStepsBlock: string): void {
    if (!isTTY) {
      stdout.write(nextStepsBlock);
      return;
    }

    const lines = [
      colorize(true, ANSI_GREEN + ANSI_BOLD, "Project ready"),
      `Location: ${sanitizeTerminalText(targetDirectory)}`,
      "",
      "Next steps:",
      ...nextStepsBlock.trimEnd().split("\n").map((line) => `  ${line}`),
    ];

    stdout.write(`\n${renderBox(lines)}\n`);
  }

  return {
    withStep,
    printSuccess,
  };
}
