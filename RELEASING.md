# Releasing Facet

Facet ships two ways: GitHub Releases (the download links in the README) and winget
(`winget install VivekSthul.Facet`). Both come from the same build.

## 1. Prepare

- [ ] `CHANGELOG.md` has an entry for the version, with the numbers it claims.
- [ ] Version bumped in `package.json` **and** `package-lock.json`.
- [ ] Test suites pass against a fresh build:
      `npm run build` then
      `node bench/verify-smoke.mjs`,
      `node bench/verify-layout.mjs --label <version>`,
      `node bench/verify-adopt.mjs`,
      `node bench/verify-relaunch.mjs --label <version>`,
      `node bench/verify-export.mjs`.
- [ ] If the release makes speed claims, rerun the benchmarks and regenerate everything that
      quotes them: `node bench/run.mjs --label <version>`, `node marketing/build-speed-data.mjs
      <old> <new>`, `node marketing/build-docs.mjs <old> <new>`, `npx electron marketing/render.js`.

## 2. Build and publish the release

Push the tag and let CI do it — a local build depends on whatever is installed on the laptop:

```
git tag -a v<version> -m "Facet <version>"
git push origin main
git push origin v<version>
```

`.github/workflows/build.yml` builds on `windows-latest`, smoke-tests the packaged app, writes
`SHA256SUMS.txt`, and opens a **draft** release with the installer, the portable exe, unversioned
copies (so `releases/latest/download/Facet-Setup.exe` keeps working), the blockmap and `latest.yml`.

Then, by hand:

- [ ] Download both exes from the draft and check the SHA-256 against `SHA256SUMS.txt`.
- [ ] Install the downloaded installer on a machine that already has Facet, and one that does not.
- [ ] Write the release notes: what changed, the speed table if there is one, checksums, and the
      SmartScreen note (Facet is not code-signed).
- [ ] Publish the release.

## 3. winget

winget requires the file behind a published manifest never to change, so the manifest points at the
**versioned** asset, and the release must be public before the manifest is generated.

```
node scripts/winget-manifest.mjs --from-release
winget validate --manifest dist/winget/manifests/v/VivekSthul/Facet/<version>
```

Then submit:

- Fork `microsoft/winget-pkgs`, copy the generated folder to the same path in the fork, open a pull
  request titled `New version: VivekSthul.Facet version <version>`.
- Or, with [wingetcreate](https://github.com/microsoft/winget-create):
  `wingetcreate submit --token <github-token> dist/winget/manifests/v/VivekSthul/Facet/<version>`.

Their automated checks run first (manifest schema, installer download, a sandbox install). A human
reviews after that; a day or two is normal. The first submission for a new package identifier takes
longer than later ones.

- [ ] After it merges, check `winget show VivekSthul.Facet` and `winget install VivekSthul.Facet`
      on a clean machine.
- [ ] Add the winget line to the README's download section.

## 4. Afterwards

- [ ] README, website and release notes all point at the new version.
- [ ] `BENCHMARKS.md` matches the shipped build if any claim changed.
- [ ] Watch the first issues; a quick patch release reads well.

## Notes

- **Not code-signed.** Windows SmartScreen warns on first run. Say so in the release notes and the
  README rather than letting people assume the download is broken.
- **The Microsoft Store is a poor fit for Facet.** Its job is launching another app with a custom
  `--user-data-dir`, and a Store (MSIX) build would have its own writes redirected into its package
  container — profile folders would stop being where the UI says they are.
- **Tag and `package.json` must agree.** CI fails the build if they do not, because the release
  assets and the winget manifest are named from them.
