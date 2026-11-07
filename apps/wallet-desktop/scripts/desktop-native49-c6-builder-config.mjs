// Selected only by build-mac's explicit c6 input option. Default legacy builds remain unchanged.
import fs from 'node:fs';
import {desktopNative49C6BuilderConfiguration} from './desktop-native49-c6-pack.mjs';
export default desktopNative49C6BuilderConfiguration(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')));
