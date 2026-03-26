import { spawn } from "node:child_process";

export type TryInitGitResult =
  | { ok: true }
  | { ok: false; error: string };

export async function tryInitGit(
  directory: string,
): Promise<TryInitGitResult> {
  return await new Promise<TryInitGitResult>((resolve) => {
    let settled = false;

    const finish = (result: TryInitGitResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    const childProcess = spawn("git", ["init"], {
      cwd: directory,
      stdio: "ignore",
    });

    childProcess.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        finish({
          ok: false,
          error: "git is not installed or is not available on PATH",
        });
        return;
      }

      finish({
        ok: false,
        error: error.message,
      });
    });

    childProcess.once("exit", (code, signal) => {
      if (signal) {
        finish({
          ok: false,
          error: `git init terminated by signal ${signal}`,
        });
        return;
      }

      if (code === 0) {
        finish({ ok: true });
        return;
      }

      finish({
        ok: false,
        error: `git init exited with code ${code ?? "unknown"}`,
      });
    });
  });
}
