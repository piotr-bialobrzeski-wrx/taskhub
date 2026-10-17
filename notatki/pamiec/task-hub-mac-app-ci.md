---
name: task-hub-mac-app-ci
description: How the Task Hub Mac app is built and released (GitHub Actions macos-14, app/VERSION drives releases, tag pushes blocked from cloud sessions, CI failures arrive as commit comments) and the Swift 5.10 pitfalls already hit
metadata:
  type: project
  modified: 2026-10-16T12:22:25.288Z
---

The Mac app lives in `macos/` (NOT `app/`: on 2026-10-16 it sat in `app/` for 1 h and Next.js took root `./app` over `src/app`, so production had no routes and everything, web app + /api/mcp + OAuth, returned 404; never create a root folder named `app` or `pages`). Build: `macos/build.sh <version> [build]` on a Mac with Command Line Tools (no Xcode project): swiftc `-parse-as-library` over Sources/*.swift for arm64 + x86_64 (target macos13.0), lipo, bundle `Task Hub.app` (id com.taskhub.app), icon from macos/Icon/icon-1024.png via sips + iconutil, ad-hoc codesign, `pkgbuild` (install-location /Applications), `hdiutil` dmg, `ditto` zip (for self-update). Cloud sessions have no swiftc: every compile check is a CI run.

CI `.github/workflows/mac-app.yml` (runner macos-14, Swift 5.10): runs on push to main touching macos/** or the workflow, on tags `app-v*`, and workflow_dispatch. Version comes from `macos/VERSION`: if release `app-v<VERSION>` does not exist yet, the run creates it as the LATEST release (tag created by `gh release create` inside Actions) with pkg + dmg + zip; otherwise it refreshes the prerelease `app-latest`. `/releases/latest` is APP_DOWNLOAD_URL in src/lib/bridge.ts (link in Task Hub Settings) and what Updater.swift reads. Pushing tags and creating refs from cloud sessions is BLOCKED by the proxy (HTTP 403), which is why the version file drives releases. The repo is public, so macOS minutes are free.

Reading results: the Actions API is blocked from cloud sessions; use `gh api repos/piotr-bialobrzeski-wrx/taskhub/commits/<sha>/check-runs` for status and `…/commits/<sha>/comments` for the failure log tail, which the workflow posts as a commit comment on failure. A build takes about 3–4 minutes; poll with a background `until` loop. Production reachability: see [[task-hub-production-diag]].

Swift 5.10 pitfalls already hit (each cost a CI round): top-level code in main.swift is NOT MainActor-isolated, so use `@main struct` with `@MainActor static func main()` and `-parse-as-library`; a `[weak self]` capture cannot be referenced inside a nested @Sendable closure (bind `let strong = self` first); escaping closures in classes need explicit `self.`; a SwiftUI `Form` in NSHostingController has zero ideal height, so set the window content size explicitly.

**Why:** lets any thread ship an app fix without a Mac and without asking Piotr to use Terminal.
**How to apply:** change code under app/, bump app/VERSION, push, watch check-runs; keep statics that non-MainActor code needs in non-isolated enums (ClaudeCLI). See [[task-hub-mac-app]].
