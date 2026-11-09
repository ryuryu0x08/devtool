// Where `npm run pack` puts the app's executable on this system (electron-builder --dir).
import { join } from 'node:path';

const DIR = join(__dirname, 'release');

export const BUILT = {
  linux: join(DIR, 'linux-unpacked', 'toolbox'),
  darwin: join(DIR, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Toolbox.app', 'Contents', 'MacOS', 'Toolbox'),
  win32: join(DIR, 'win-unpacked', 'Toolbox.exe'),
}[process.platform as string];
