import assert from "node:assert/strict";
import test from "node:test";
import { locales } from "./i18n";
import { walletUICopy } from "./wallet-ui-copy";

test("wallet lifecycle copy is complete in every supported locale",()=>{
  const expected=Object.keys(walletUICopy.en).sort();
  for(const locale of locales){
    assert.deepEqual(Object.keys(walletUICopy[locale]).sort(),expected,locale);
    for(const [key,value] of Object.entries(walletUICopy[locale]))assert.ok(value.trim(),`${locale}.${key}`);
    assert.match(walletUICopy[locale].noProviderBody,/private key|私钥|私鑰|秘密鍵|개인 키|clave privada|clé privée|privatem Schlüssel|chave privada|закрытый ключ|المفتاح الخاص|kunci privat/i);
  }
});

test("wallet identity copy keeps YNX Wallet and MetaMask distinct",()=>{
  for(const locale of locales){
    assert.match(walletUICopy[locale].chooseInstalled,/YNX Wallet/i);
    assert.match(walletUICopy[locale].chooseInstalled,/MetaMask/i);
    assert.notEqual(walletUICopy[locale].ynxProvider,walletUICopy[locale].metaMaskProvider);
  }
});
