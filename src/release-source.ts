export type GitHubReleaseAsset = {
  browser_download_url?: string;
  name: string;
};

type GitHubReleaseDownloadAsset = {
  browser_download_url: string;
  name: string;
};

export type GitHubRelease = {
  assets: GitHubReleaseAsset[];
  created_at?: string;
  draft: boolean;
  prerelease: boolean;
  published_at?: string;
  tag_name: string;
};

export type ResolvedTemplateRelease = {
  assetName: string;
  downloadUrl: string;
  tagName: string;
  templateVersion: string;
};

export type ResolveTemplateReleaseOptions = {
  fetch?: typeof globalThis.fetch;
  releasesApiUrl?: string;
  templateVersion?: string;
};

export const DEFAULT_RELEASES_API_URL =
  "https://api.github.com/repos/plancy/starter-web/releases";

function parseReleaseTimestamp(release: GitHubRelease): number {
  const timestamp = release.published_at ?? release.created_at;

  if (!timestamp) {
    return 0;
  }

  return Date.parse(timestamp);
}

function toPinnedTagName(templateVersion: string): string {
  return `v${templateVersion}`;
}

function toStarterArchiveAssetName(tagName: string): string {
  return `starter-web-${tagName}.tar.gz`;
}

function resolveReleaseVersion(tagName: string): string {
  return tagName.startsWith("v") ? tagName.slice(1) : tagName;
}

async function fetchReleases(
  releasesApiUrl: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<GitHubRelease[]> {
  let response: Response;

  try {
    response = await fetchImpl(releasesApiUrl, {
      headers: {
        accept: "application/vnd.github+json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Failed to load starter releases from GitHub Releases API: ${message}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Failed to load starter releases from GitHub Releases API (${response.status} ${response.statusText})`,
    );
  }

  let body: unknown;

  try {
    body = (await response.json()) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Failed to load starter releases from GitHub Releases API: ${message}`,
    );
  }

  if (!Array.isArray(body)) {
    throw new Error(
      "Failed to load starter releases from GitHub Releases API: expected a JSON array response",
    );
  }

  return body as GitHubRelease[];
}

function selectLatestStableRelease(releases: GitHubRelease[]): GitHubRelease {
  const stableReleases = [...releases]
    .filter((release) => !release.draft && !release.prerelease)
    .sort(
      (left, right) =>
        parseReleaseTimestamp(right) - parseReleaseTimestamp(left),
    );

  const latestStableRelease = stableReleases[0];

  if (!latestStableRelease) {
    throw new Error("No stable starter release was found in GitHub Releases");
  }

  return latestStableRelease;
}

function selectPinnedRelease(
  releases: GitHubRelease[],
  templateVersion: string,
): GitHubRelease {
  const tagName = toPinnedTagName(templateVersion);
  const pinnedRelease = releases.find((release) => release.tag_name === tagName);

  if (!pinnedRelease) {
    throw new Error(
      `Could not find template version ${templateVersion} in GitHub Releases (expected tag ${tagName})`,
    );
  }

  return pinnedRelease;
}

function resolveStarterArchiveAsset(
  release: GitHubRelease,
): GitHubReleaseDownloadAsset {
  const assetName = toStarterArchiveAssetName(release.tag_name);
  const asset = release.assets.find(({ name }) => name === assetName);

  if (!asset?.browser_download_url) {
    throw new Error(
      `Release ${release.tag_name} is missing required asset ${assetName}`,
    );
  }

  return {
    name: asset.name,
    browser_download_url: asset.browser_download_url,
  };
}

export async function resolveTemplateRelease(
  options: ResolveTemplateReleaseOptions = {},
): Promise<ResolvedTemplateRelease> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const releasesApiUrl = options.releasesApiUrl ?? DEFAULT_RELEASES_API_URL;
  const releases = await fetchReleases(releasesApiUrl, fetchImpl);
  const release = options.templateVersion
    ? selectPinnedRelease(releases, options.templateVersion)
    : selectLatestStableRelease(releases);
  const asset = resolveStarterArchiveAsset(release);

  return {
    assetName: asset.name,
    downloadUrl: asset.browser_download_url,
    tagName: release.tag_name,
    templateVersion:
      options.templateVersion ?? resolveReleaseVersion(release.tag_name),
  };
}
