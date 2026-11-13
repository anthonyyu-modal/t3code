# anthonyyu-modal/t3code

Upstream T3 Code plus a small patch stack, released from this repository.

## What differs from upstream

- **Linux `t3` runs on Oracle UEK kernels.** UEK refuses an ELF whose last `PT_NOTE` is over 4 MiB, and Node's single-executable blob is ~13 MB. `scripts/build-cli-archive.ts` gives the blob its own `PT_NOTE`.
- **Remote install errors say why.** The SSH runner reports `t3 --version` output and `uname` when a downloaded binary does not run.
- **SSH tunnels ignore failing `LocalForward`s** from `~/.ssh/config` (no `ExitOnForwardFailure`).
- **Archives come from this fork.** `CLI_RELEASE_REPOSITORY` in `packages/shared/src/cliRelease.ts` points here, so SSH remotes and runtimes install this fork's patched archives.
- **Unsigned macOS builds are ad hoc signed and self-update in-app from the release `.zip`** (`scripts/build-desktop-artifact.ts`, `apps/desktop/src/electron/MacZipUpdater.ts`): macOS refuses notifications from an app whose bundle is not signed, and Squirrel.Mac cannot install an ad hoc signed update because its designated requirement pins the running binary's `cdhash`. Unsigned macOS builds publish `nightly-mac.yml` and replace `/Applications/T3 Code (Nightly).app` directly from the verified `.zip` archive via `ditto --noqtn` without setting `com.apple.quarantine`.
- **Settings → General → Test notification** posts a notification on demand: macOS lists an app in System Settings → Notifications only after it posts one.
- **In-app alerts can also send a system notification** (Settings → General → System notifications for in-app alerts, off by default, kept on this device), so an alert stays clickable in Notification Center after its in-app toast disappears.
- **Settings rows this fork adds carry a Fork badge** (`forkSetting` in `apps/web/src/components/settings/forkSetting.tsx`); searching settings for "fork" lists them.
- **A divider line separates pinned threads** from unpinned ones in the sidebar.
- **Threads with an open pull request stay at full strength in the sidebar.** Upstream dims a thread once you have read its finished run, or while it works in the background. Here an open PR keeps it bright until the PR merges or closes (`shouldRecedeSidebarThread` in `apps/web/src/components/Sidebar.logic.ts`). Settled and snoozed rows stay grey.
- **Short threads get their own Quick section** (Settings → General → Quick section, on at 2 messages by default, kept on this device). An Active thread where you have written at most that many messages sits in a collapsible Quick shelf below Active, latest activity first, and moves up to Active once you write more. Quick threads can be dragged to Pinned or Settled, but nothing drops into Quick. The server sends the count as `userAuthoredMessageCount` on each thread shell, so threads from a server without this fork's build stay in Active.
- **Forked threads and `/btw` / `/side` side chats nest underneath their parent thread in the sidebar** as compact tree sub-rows (`apps/web/src/components/sidebar/SidebarThreadRow.tsx` and `apps/web/src/components/Sidebar.logic.ts`), capped at two indent levels, with a count pill on the parent to collapse or expand its branches and a status dot while collapsed if a hidden child needs attention. Full forks show a `⑂` icon, keep inbox fork families out of Quick once any live branch exceeds the Quick limit, and stay in Active with a clickable `⑂ parent` breadcrumb chip when their parent moves to another shelf. Side chats (`lineage.sideChat`) show a chat icon, open in their parent thread's right-panel side-chat tab on click, highlight while that tab is open, and tuck away when settled or when their parent leaves the inbox.
- **Thread thumbnails** (Settings → General → Thread thumbnails): a self-hosted image model draws a picture for each thread from its title, shown on its sidebar card. The client calls the endpoint directly with an OpenAI-style images request and caches 96px WebP thumbnails in IndexedDB, all per device (`apps/web/src/threadThumbnails.ts`). The matching Modal app lives outside this repository in `~/workspace/projects/t3-thumbnails`.
- **Titles can follow the conversation** (Settings → Threads → Regenerate titles after each turn, off by default, per environment with project overrides). When a run completes, the server asks for the same title regeneration as the thread menu's Regenerate title, keyed by run so a run regenerates once (`apps/server/src/orchestration-v2/ThreadTitleAutoRegenerationReactor.ts`). It also replaces titles you set by hand. Mobile has no control for it yet.
- **Selecting a word in the file viewer highlights its other occurrences**, like VS Code's selection highlight. Matching is by text: case-sensitive and whole-word, with `_`, `$`, digits, and letters in any script counted as word characters. It has no language server, so it cannot tell two variables with the same name apart. Painted with the CSS Custom Highlight API (`apps/web/src/components/files/wordOccurrenceHighlights.ts`).
- **Citing an assistant selection has a shortcut** (Settings → Keybindings → Composer: Cite Selection, `mod+shift+.` by default). With text selected in an assistant response, the shortcut inserts its quote chip into the composer and opens the inline comment box, just like the floating **Cite** button (`assistantSelection` is also available as a `when` condition for single-key bindings).
- **Each thread has a whiteboard that you and its agent both draw on** (right panel → **+** → Whiteboard, or the command palette; [user guide](docs/user/whiteboard.md)). It is an Excalidraw board kept per thread as a JSON file under T3 home (`userdata/whiteboards/`) rather than in SQLite, so this fork owns no migration id that upstream could later reuse. Agents read it with `whiteboard_read`, draw with `whiteboard_edit`, and get a picture from an open tab with `whiteboard_view` (`apps/server/src/whiteboard/`, `apps/server/src/mcp/toolkits/whiteboard/`). An agent's drawing opens the tab, and what the user changed reaches Claude and Codex agents as a note with the next message. For that, Claude now also receives the notes MCP apps leave for the model (`withClaudeAppContext` in `ClaudeAdapterV2.ts`), which upstream sends only to Codex. Excalidraw's fonts ship with the app (`apps/web/vite/excalidrawFonts.ts`) because the desktop content policy blocks its CDN, and `pnpm-workspace.yaml` overrides its Radix Tabs pin so React 19 passes the strict peer check. Mobile has no tab for it yet.
- **`fork-release.yml`** builds the macOS arm64 app and the macOS arm64 + Linux x64 CLI archives on GitHub-hosted runners and publishes a release on the nightly train. Every other workflow is disabled in this repository.

## Release

```bash
gh workflow run fork-release.yml -R anthonyyu-modal/t3code
```

Builds are nightly versions (`T3 Code (Nightly)`, Orchestrator V2, nightly-only settings) and ad hoc signed. Once installed in `/Applications`, the desktop app checks this repository's releases and installs newer builds in-app from the `.zip` archive without quarantine prompts.

## Install (macOS, first time)

```bash
gh release download -R anthonyyu-modal/t3code -p '*arm64.dmg' -D /tmp/t3-fork --clobber
```

Open the .dmg and drag the app to Applications. It installs as `T3 Code (Nightly).app`, replacing the official Nightly, and uses the same `~/.t3` data. If you downloaded the `.dmg` in a browser and macOS refuses to open it (unverified developer, or "damaged"): `xattr -dr com.apple.quarantine "/Applications/T3 Code (Nightly).app"`. Subsequent updates install in-app.

## Sync with upstream

`main` is always the commit the newest upstream nightly was built from, with this fork's commits as one linear stack on top:

- **Base on the newest nightly, not upstream `main`.** Nightlies are what upstream has released; `main` can be ahead of them.
- **Rebase, never merge.** Fork commits must never sit between upstream commits. New fork commits go on top of the stack.
- **Drop patches upstream made unnecessary.** On every sync, check each fork commit against what upstream shipped. If upstream fixed the same problem, delete the commit from the stack (skip it in the rebase) instead of keeping or reverting it.
- **Check the stack before pushing.** Upstream's types and lint rules change under the fork's code, and the release workflow runs neither. Use the Node version in `package.json` `engines`, and fold each fix into the fork commit that owns the code (`git commit --fixup`, then `git rebase -i --autosquash "$nightly"`).

```bash
git fetch upstream --tags
nightly=$(gh release list -R pingdotgg/t3code --limit 20 --json tagName \
  -q '[.[] | select(.tagName | test("-nightly\\."))][0].tagName')
git rebase --onto "$nightly" "$(git merge-base main upstream/main)" main
pnpm install && pnpm typecheck
git diff --name-only "$nightly" -- '*.ts' '*.tsx' | xargs pnpm exec vp lint
git push --force-with-lease origin main
gh workflow run fork-release.yml -R anthonyyu-modal/t3code
```

If upstream added workflows, disable them here (`gh workflow disable <name> -R anthonyyu-modal/t3code`); only Fork Release and Release desktop build stay enabled.
