import {access} from 'node:fs/promises';

const macChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Developer macOS runs use installed Chrome; hosted Linux CI uses Playwright's
// pinned Chromium after its explicit install step. Neither is installed-Wallet
// or public-provider evidence: all Wallet providers in these tests are fixtures.
export async function financeBrowserLaunchOptions(){
  if(process.platform==='darwin'){
    try{await access(macChrome);return {headless:true,executablePath:macChrome};}catch{}
  }
  return {headless:true};
}
