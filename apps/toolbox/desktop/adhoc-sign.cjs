// macOS: the built app signed ad hoc (no Apple developer identity here). Apple chips run only
// signed code, and the bundle changed after Electron's own signature (the toolbox was added).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
