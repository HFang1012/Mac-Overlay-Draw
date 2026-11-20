// Builds build/Pane.app for this Mac and signs it locally so macOS will open it.
//
// The version comes from your newest git tag (v1.2.3 → 1.2.3), so tagging a release is all it takes:
//   git tag v1.2.3 && npm run release
// Fallbacks: PANE_VERSION=1.2.3 npm run package, then package.json's "version".
const { packager } = require('@electron/packager');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build');
const pkg = require(path.join(root, 'package.json'));

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

function pickVersion() {
  const env = process.env.PANE_VERSION || process.env.SCRAWL_VERSION;
  if (env) return { version: env, from: 'PANE_VERSION' };
  const tag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
  if (tag) {
    const ahead = Number(git('rev-list', '--count', `${tag}..HEAD`) || 0);
    const note = ahead ? `tag ${tag}, plus ${ahead} newer commit${ahead === 1 ? '' : 's'} not yet tagged` : `tag ${tag}`;
    return { version: tag.replace(/^v/, ''), from: note };
  }
  return { version: pkg.version, from: 'package.json' };
}

(async () => {
  const { version, from } = pickVersion();
  if (!/^\d+(\.\d+){0,2}$/.test(version)) {
    console.error(`"${version}" isn't a version like 1.2.3. Tag releases as v1.2.3.`);
    process.exit(1);
  }
  console.log(`Building Pane ${version} (from ${from})`);

  // Only clear what this script makes; build/ also holds the .dmg tooling.
  fs.rmSync(path.join(build, 'Pane.app'), { recursive: true, force: true });
  fs.rmSync(path.join(build, '.tmp'), { recursive: true, force: true });

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const [appDir] = await packager({
    dir: root,
    name: 'Pane',
    platform: 'darwin',
    arch,
    out: path.join(build, '.tmp'),
    overwrite: true,
    icon: path.join(root, 'assets', 'icon.icns'),
    appBundleId: 'com.pane.app',
    // Spin drives Spotify and Music with Apple Events; macOS shows this when it asks you to allow that.
    extendInfo: { NSAppleEventsUsageDescription: 'Spin plays, skips and sets the volume in your music app.' },
    appVersion: version, // Finder's "Version" and the About window (CFBundleShortVersionString)
    buildVersion: version, // CFBundleVersion
    ignore: [/^\/(build|assets|scripts|docs|\.claude|\.github)(\/|$)/, /\/prebuilds\/(linux|win32)\//],
    // The running app reports its version from its own package.json, so stamp the same number there.
    afterCopy: [({ buildPath }) => {
      const file = path.join(buildPath, 'package.json');
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      json.version = version;
      fs.writeFileSync(file, JSON.stringify(json, null, 2));
    }],
  });

  fs.renameSync(path.join(appDir, 'Pane.app'), path.join(build, 'Pane.app'));
  fs.rmSync(path.join(build, '.tmp'), { recursive: true, force: true });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(build, 'Pane.app')], { stdio: 'inherit' });
  console.log(`Built build/Pane.app (version ${version})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
