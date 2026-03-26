# create-plancy-app

Thin Bun-based CLI for scaffolding the public Plancy starter.

## Usage

```bash
bun create plancy-app my-plancy-app
```

Scaffold into the current directory:

```bash
bun create plancy-app .
```

If the target directory already exists and is non-empty, the CLI asks before replacing its contents when running in an interactive terminal. In non-interactive mode, non-empty directories still fail fast.

Supported flags:

```bash
bun create plancy-app <directory> \
  [--template-version <version>] \
  [--package-name <name>] \
  [--app-name <name>] \
  [--skip-git-init]
```

## Release contract

GitHub Releases are the source of truth for starter downloads.

- Latest stable resolution only considers releases where `draft === false` and `prerelease === false`.
- Each starter release must publish an asset named exactly `starter-web-vX.Y.Z.tar.gz`.
- `--template-version 1.2.3` resolves directly to the Git tag `v1.2.3`.

## Manifest validation failures

The CLI validates `starter.manifest.json` before mutating the target directory. It fails fast when:

- the manifest schema version is unsupported
- required token declarations or file lists are invalid
- manifest-listed files are missing or are not regular files
- the resolved release version does not match `templateVersion` in the manifest

Project writing performs the same manifest-listed file existence check again inside the staging directory before token substitution, so a broken extracted starter never mutates the final target.

## Next steps after success

The CLI prints this exact block after scaffolding succeeds:

```text
bun install
# set DATABASE_URL in .env
bunx prisma migrate dev
bun run dev
```
