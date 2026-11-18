// Where `npm run pack` puts the app's executable on this system (electron-builder --dir).
import { join } from 'node:path';

const DIR = join(__dirname, 'release');

export const BUILT = {
  linux: join(DIR, 'linux-unpacked', 'devtool'),
  darwin: join(DIR, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'devtool.app', 'Contents', 'MacOS', 'devtool'),
  win32: join(DIR, 'win-unpacked', 'devtool.exe'),
}[process.platform as string];
