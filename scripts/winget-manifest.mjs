#!/usr/bin/env node
/**
 * Write the three winget manifest files for a released version.
 *
 *   node scripts/winget-manifest.mjs                 # hashes dist/Facet-Setup-<version>.exe
 *   node scripts/winget-manifest.mjs --from-release  # downloads the asset from GitHub and hashes that
 *
 * Output: dist/winget/manifests/v/VivekSthul/Facet/<version>/ — the layout winget-pkgs expects.
 * Submit by copying that folder into a fork of microsoft/winget-pkgs and opening a pull request,
 * or with `wingetcreate submit dist/winget/manifests/...`.
 *
 * The installer URL must point at the versioned asset: winget requires the file behind a published
 * manifest never to change, and Facet-Setup.exe (the unversioned copy) is replaced every release.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const VERSION = process.argv.find((a) => /^\d+\.\d+\.\d+$/.test(a)) || pkg.version;
const ID = 'VivekSthul.Facet';
const OWNER = 'viveksthul15';
const ASSET = `Facet-Setup-${VERSION}.exe`;
const URL = `https://github.com/${OWNER}/facet/releases/download/v${VERSION}/${ASSET}`;
const SCHEMA = '1.6.0';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();

let bytes;
if (process.argv.includes('--from-release')) {
  process.stdout.write(`downloading ${URL}\n`);
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — is v${VERSION} published?`);
  bytes = Buffer.from(await res.arrayBuffer());
} else {
  const local = path.join(REPO, 'dist', ASSET);
  if (!fs.existsSync(local)) throw new Error(`${local} not found — build it, or pass --from-release`);
  bytes = fs.readFileSync(local);
}
const hash = sha256(bytes);

const header = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${SCHEMA}.schema.json

PackageIdentifier: ${ID}
PackageVersion: ${VERSION}`;

const files = {
  [`${ID}.yaml`]: `${header('version')}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${SCHEMA}
`,

  // electron-builder's NSIS installer: per-user, silent with /S, and it replaces itself on upgrade.
  [`${ID}.installer.yaml`]: `${header('installer')}
InstallerType: nullsoft
Scope: user
InstallModes:
  - interactive
  - silent
  - silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
  - Architecture: x64
    InstallerUrl: ${URL}
    InstallerSha256: ${hash}
ManifestType: installer
ManifestVersion: ${SCHEMA}
`,

  [`${ID}.locale.en-US.yaml`]: `${header('defaultLocale')}
PackageLocale: en-US
Publisher: Vivek Sthul
PublisherUrl: https://github.com/${OWNER}
PublisherSupportUrl: https://github.com/${OWNER}/facet/issues
Author: Vivek Sthul
PackageName: Facet
PackageUrl: https://github.com/${OWNER}/facet
License: MIT
LicenseUrl: https://github.com/${OWNER}/facet/blob/main/LICENSE
Copyright: Copyright (c) ${new Date().getFullYear()} Vivek Sthul
ShortDescription: Run several Claude Desktop accounts side by side from the Windows tray.
Description: |-
  Facet is a small Windows tray launcher that opens Claude Desktop on the right account every
  time. Each profile gets its own data directory, so sessions stay put and you sign in once per
  account. It never reads or copies your session material, and it never uses the network.

  It can also adopt the account you are already signed into, export any Claude Code session to a
  zip, and run in portable mode from a USB drive.
Moniker: facet
Tags:
  - claude
  - profiles
  - tray
  - launcher
  - productivity
ReleaseNotesUrl: https://github.com/${OWNER}/facet/releases/tag/v${VERSION}
ManifestType: defaultLocale
ManifestVersion: ${SCHEMA}
`,
};

const out = path.join(REPO, 'dist', 'winget', 'manifests', 'v', 'VivekSthul', 'Facet', VERSION);
fs.mkdirSync(out, { recursive: true });
for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(out, name), body);
console.log(`${ID} ${VERSION}`);
console.log(`  installer ${URL}`);
console.log(`  sha256    ${hash}`);
console.log(`  written   ${path.relative(REPO, out)}`);
console.log('\nnext: winget validate --manifest <that folder>');
console.log('      then copy it into a fork of microsoft/winget-pkgs and open a pull request');
