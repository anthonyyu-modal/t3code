# anthonyyu-modal/t3code

Upstream T3 Code plus a small patch stack, released from this repository.

## What differs from upstream

- **Linux `t3` runs on Oracle UEK kernels.** UEK refuses an ELF whose last `PT_NOTE` is over 4 MiB, and Node's single-executable blob is ~13 MB. `scripts/build-cli-archive.ts` gives the blob its own `PT_NOTE`.
- **Remote install errors say why.** The SSH runner reports `t3 --version` output and `uname` when a downloaded binary does not run.
- **SSH tunnels ignore failing `LocalForward`s** from `~/.ssh/config` (no `ExitOnForwardFailure`).
- **Archives come from this fork.** `CLI_RELEASE_REPOSITORY` in `packages/shared/src/cliRelease.ts` points here, so SSH remotes and runtimes install this fork's patched archives.
- **`fork-release.yml`** builds the macOS arm64 app and the macOS arm64 + Linux x64 CLI archives on GitHub-hosted runners and publishes a release. Every other workflow is disabled in this repository.

## Release

```bash
gh workflow run fork-release.yml -R anthonyyu-modal/t3code
```

Builds are unsigned (ad hoc) and use the `-preview.` version train, so the app has no update feed: rerun the workflow and reinstall to update.

## Install (macOS)

```bash
gh release download -R anthonyyu-modal/t3code -p '*arm64.dmg' -D /tmp/t3-fork --clobber
```

Open the .dmg and drag the app to Applications. It installs as `T3 Code.app` (shown as "T3 Code (Alpha)") next to the official Nightly and shares its `~/.t3` data, so run one at a time. If macOS says it is damaged: `xattr -dr com.apple.quarantine "/Applications/T3 Code.app"`.

## Sync with upstream

```bash
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin main
```
