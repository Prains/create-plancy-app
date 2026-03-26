import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTemplateArchive } from "../src/download-template";
import {
  resolveTemplateRelease,
  type GitHubRelease,
} from "../src/release-source";

const execFileAsync = promisify(execFile);

function createRelease(overrides: Partial<GitHubRelease>): GitHubRelease {
  const tagName = overrides.tag_name ?? "v0.1.0";

  return {
    tag_name: tagName,
    draft: false,
    prerelease: false,
    published_at: "2026-03-25T12:00:00.000Z",
    assets: [
      {
        name: `starter-web-${tagName}.tar.gz`,
        browser_download_url: `https://example.com/starter-web-${tagName}.tar.gz`,
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

async function createArchiveFixture(options: {
  manifestContents?: string;
  nestedRoot?: boolean;
} = {}): Promise<string> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "create-plancy-app-test-"));
  const sourceDirectory = path.join(tempDirectory, "source");
  const archivePath = path.join(tempDirectory, "starter-web.tar.gz");

  if (options.nestedRoot) {
    const nestedRootDirectory = path.join(sourceDirectory, "starter-web");

    await mkdir(nestedRootDirectory, { recursive: true });
    await writeFile(
      path.join(nestedRootDirectory, "starter.manifest.json"),
      options.manifestContents ?? '{"schemaVersion":1}',
      "utf8",
    );
    await execFileAsync("tar", ["-czf", archivePath, "-C", sourceDirectory, "starter-web"]);

    return archivePath;
  }

  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    path.join(sourceDirectory, "starter.manifest.json"),
    options.manifestContents ?? '{"schemaVersion":1}',
    "utf8",
  );
  await execFileAsync("tar", ["-czf", archivePath, "-C", sourceDirectory, "."]);

  return archivePath;
}

const createdDirectories = new Set<string>();

async function createTempParentDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "create-plancy-app-parent-"));

  createdDirectories.add(directory);

  return directory;
}

afterEach(async () => {
  await Promise.all(
    [...createdDirectories].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
      createdDirectories.delete(directory);
    }),
  );
});

describe("release source contract", () => {
  it("latest stable ignores drafts and prereleases", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        createRelease({
          tag_name: "v0.3.0",
          prerelease: true,
          published_at: "2026-03-25T18:00:00.000Z",
        }),
        createRelease({
          tag_name: "v0.2.0",
          draft: true,
          published_at: "2026-03-25T17:00:00.000Z",
        }),
        createRelease({
          tag_name: "v0.1.1",
          published_at: "2026-03-25T16:00:00.000Z",
        }),
      ]),
    );

    const release = await resolveTemplateRelease({
      fetch,
      releasesApiUrl: "https://api.example.test/releases",
    });

    expect(release.tagName).toBe("v0.1.1");
    expect(release.assetName).toBe("starter-web-v0.1.1.tar.gz");
  });

  it("pinned version 1.2.3 resolves to tag v1.2.3", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        createRelease({
          tag_name: "v1.2.3",
          published_at: "2026-03-25T18:00:00.000Z",
        }),
      ]),
    );

    const release = await resolveTemplateRelease({
      templateVersion: "1.2.3",
      fetch,
      releasesApiUrl: "https://api.example.test/releases",
    });

    expect(release.tagName).toBe("v1.2.3");
    expect(release.templateVersion).toBe("1.2.3");
  });

  it("non-existent pinned version fails with an actionable error", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        createRelease({
          tag_name: "v1.2.2",
        }),
      ]),
    );

    await expect(
      resolveTemplateRelease({
        templateVersion: "1.2.3",
        fetch,
        releasesApiUrl: "https://api.example.test/releases",
      }),
    ).rejects.toThrow(/template version 1\.2\.3.*v1\.2\.3/i);
  });

  it("missing starter-web-vX.Y.Z.tar.gz asset fails", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        createRelease({
          tag_name: "v1.2.3",
          assets: [{ name: "checksums.txt", browser_download_url: "https://example.com/checksums.txt" }],
        }),
      ]),
    );

    await expect(
      resolveTemplateRelease({
        templateVersion: "1.2.3",
        fetch,
        releasesApiUrl: "https://api.example.test/releases",
      }),
    ).rejects.toThrow(/starter-web-v1\.2\.3\.tar\.gz/i);
  });

  it("wraps rejected GitHub Releases fetches in an actionable error", async () => {
    await expect(
      resolveTemplateRelease({
        fetch: vi.fn(async () => {
          throw new Error("rate limited");
        }),
        releasesApiUrl: "https://api.example.test/releases",
      }),
    ).rejects.toThrow(/failed to load starter releases.*rate limited/i);
  });

  it("rejects malformed successful GitHub Releases responses", async () => {
    const fetch = vi.fn(async () =>
      new Response('{"message":"not-an-array"}', {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(
      resolveTemplateRelease({
        fetch,
        releasesApiUrl: "https://api.example.test/releases",
      }),
    ).rejects.toThrow(/failed to load starter releases.*array/i);
  });

  it("wraps GitHub Releases JSON parse failures in an actionable error", async () => {
    const fetch = vi.fn(async () =>
      new Response("not json", {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(
      resolveTemplateRelease({
        fetch,
        releasesApiUrl: "https://api.example.test/releases",
      }),
    ).rejects.toThrow(/failed to load starter releases/i);
  });
});

describe("template archive download", () => {
  it("extracts into a temp directory with starter.manifest.json at extracted root", async () => {
    const archivePath = await createArchiveFixture({
      manifestContents: '{"schemaVersion":1,"templateVersion":"0.1.0"}',
    });
    const archiveBuffer = await readFile(archivePath);

    const downloadedTemplate = await downloadTemplateArchive(
      {
        assetName: "starter-web-v0.1.0.tar.gz",
        downloadUrl: "https://example.com/starter-web-v0.1.0.tar.gz",
      },
      {
        fetch: vi.fn(async () => new Response(archiveBuffer, { status: 200 })),
      },
    );

    try {
      const manifestPath = path.join(
        downloadedTemplate.extractedDirectory,
        "starter.manifest.json",
      );
      const manifestContents = await readFile(manifestPath, "utf8");

      expect(downloadedTemplate.extractedDirectory).toContain(os.tmpdir());
      expect(manifestContents).toContain('"templateVersion":"0.1.0"');
    } finally {
      await downloadedTemplate.cleanup();
    }
  });

  it("removes temp extraction directories when download fails", async () => {
    const tempParentDirectory = await createTempParentDirectory();

    await expect(
      downloadTemplateArchive(
        {
          assetName: "starter-web-v0.1.0.tar.gz",
          downloadUrl: "https://example.com/starter-web-v0.1.0.tar.gz",
        },
        {
          fetch: vi.fn(async () => new Response("nope", { status: 500 })),
          tempParentDirectory,
        },
      ),
    ).rejects.toThrow(/download/i);

    await expect(readdir(tempParentDirectory)).resolves.toEqual([]);
  });

  it("reports transport failures as download failures and removes temp directories", async () => {
    const tempParentDirectory = await createTempParentDirectory();

    await expect(
      downloadTemplateArchive(
        {
          assetName: "starter-web-v0.1.0.tar.gz",
          downloadUrl: "https://example.com/starter-web-v0.1.0.tar.gz",
        },
        {
          fetch: vi.fn(async () => {
            throw new Error("socket hang up");
          }),
          tempParentDirectory,
        },
      ),
    ).rejects.toThrow(/download.*socket hang up/i);

    await expect(readdir(tempParentDirectory)).resolves.toEqual([]);
  });

  it("removes temp extraction directories when extraction fails", async () => {
    const tempParentDirectory = await createTempParentDirectory();

    await expect(
      downloadTemplateArchive(
        {
          assetName: "starter-web-v0.1.0.tar.gz",
          downloadUrl: "https://example.com/starter-web-v0.1.0.tar.gz",
        },
        {
          fetch: vi.fn(async () => new Response(Buffer.from("not-a-tarball"), { status: 200 })),
          tempParentDirectory,
        },
      ),
    ).rejects.toThrow(/extract/i);

    await expect(readdir(tempParentDirectory)).resolves.toEqual([]);
  });
});
