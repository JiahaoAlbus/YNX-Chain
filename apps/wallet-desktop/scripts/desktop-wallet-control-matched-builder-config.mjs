// Selected only by the explicit matched Control normal-input option.
import fs from 'node:fs';
import {desktopWalletControlMatchedBuilderConfiguration} from './desktop-wallet-control-matched-pack.mjs';
export default desktopWalletControlMatchedBuilderConfiguration(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')));
