# create-plancy-app

Thin Bun-based CLI for scaffolding the public Plancy starter.

## Usage

```bash
bun create plancy-app <directory> [--template-version <version>] [--package-name <name>] [--app-name <name>] [--skip-git-init]
```

## Release contract

GitHub Releases are the source of truth for starter downloads.

- Latest stable resolution only considers releases where `draft === false` and `prerelease === false`.
- Each starter release must publish an asset named exactly `starter-web-vX.Y.Z.tar.gz`.
- `--template-version 1.2.3` resolves directly to the Git tag `v1.2.3`.
