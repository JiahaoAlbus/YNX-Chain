import test from 'node:test';
import assert from 'node:assert/strict';
import {centralUILanguage,centralUIText,centralUIPage} from '../src/central-browser-session-locale.js';
test('UI language uses bounded Chinese/English variants and safe fallback, never arbitrary markup',()=>{
  for(const [value,want]of [['zh-Hans','zh-CN'],['zh-TW','zh-Hant'],['zh-HK','zh-Hant'],['en-US','en'],['zh-CN,en;q=0.8','zh-CN'],['<script>','en'],['https://attacker.invalid','en'],['fr','en']])assert.equal(centralUILanguage(value),want);
  const script='<script type="application/json">{"csrfToken":"isolated","origin":"https://finance.ynxweb4.com"}</script>';
  const page=centralUIPage('<html lang="en"><h1>Sign in with YNX Wallet</h1>'+script+'</html>','zh-CN');
  assert.match(page,/<html lang="zh-CN">/);assert.match(page,/使用 YNX Wallet 登录/);assert.ok(page.includes(script));
  assert.equal(centralUIText(centralUIText('Cancel','zh-CN'),'en'),'Cancel');
  assert.equal(centralUIText('Wallet Web connection did not finish (PRIVATE_DETAIL). Retry or cancel.','zh-CN'),'钱包或服务暂不可用，尚未登录。请重试或取消。');
});
