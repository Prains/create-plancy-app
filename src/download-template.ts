import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import * as tar from "tar";

export type DownloadTemplateArchiveInput = {
  assetName: string;
  downloadUrl: string;
};

export type DownloadTemplateArchiveDependencies = {
  fetch?: typeof globalThis.fetch;
  tempParentDirectory?: string;
};

export type DownloadedTemplateArchive = {
  cleanup: () => Promise<void>;
  extractedDirectory: string;
};

async function cleanupDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

async function downloadArchiveToPath(
  input: DownloadTemplateArchiveInput,
  archivePath: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  let response: Response;

  try {
    response = await fetchImpl(input.downloadUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Failed to download ${input.assetName} from ${input.downloadUrl}: ${message}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download ${input.assetName} from ${input.downloadUrl} (${response.status} ${response.statusText})`,
    );
  }

  if (!response.body) {
    throw new Error(
      `Failed to download ${input.assetName} from ${input.downloadUrl}: empty response body`,
    );
  }

  try {
    await pipeline(
      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      createWriteStream(archivePath),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Failed to download ${input.assetName} from ${input.downloadUrl}: ${message}`,
    );
  }
}

export async function downloadTemplateArchive(
  input: DownloadTemplateArchiveInput,
  dependencies: DownloadTemplateArchiveDependencies = {},
): Promise<DownloadedTemplateArchive> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const tempParentDirectory = dependencies.tempParentDirectory ?? os.tmpdir();
  const extractedDirectory = await mkdtemp(
    path.join(tempParentDirectory, "create-plancy-app-"),
  );
  const archivePath = path.join(extractedDirectory, input.assetName);

  try {
    await downloadArchiveToPath(input, archivePath, fetchImpl);
    await tar.x({
      cwd: extractedDirectory,
      file: archivePath,
      strict: true,
    });
    await rm(archivePath, { force: true });

    return {
      extractedDirectory,
      cleanup: async () => cleanupDirectory(extractedDirectory),
    };
  } catch (error) {
    await rm(archivePath, { force: true });
    await cleanupDirectory(extractedDirectory);
    const message = error instanceof Error ? error.message : String(error);

    if (/^Failed to download /i.test(message)) {
      throw error;
    }

    throw new Error(`Failed to extract ${input.assetName}: ${message}`);
  }
}
