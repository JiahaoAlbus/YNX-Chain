import assert from "node:assert/strict";
import test from "node:test";
import {webcrypto} from "node:crypto";
import {EXTENSION_VAULT_KDF_ITERATIONS,createEncryptedVault,extensionIdentity,generateExtensionSecret,parseEncryptedVault,providerAccountFromVault,unlockEncryptedVault} from "../src/extension-vault.js";

const SECRET=`${"00".repeat(31)}01`,PASSWORD="correct horse battery staple",NOW="2026-08-22T05:00:00.000Z";

test("encrypted extension vault derives the canonical 0x account and unlocks only with its password",async()=>{
  const identity=extensionIdentity(SECRET),vault=await createEncryptedVault({password:PASSWORD,secretHex:SECRET,createdAt:NOW},webcrypto),unlocked=await unlockEncryptedVault(vault,PASSWORD,webcrypto);
  assert.equal(identity.account,"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  assert.equal(vault.account,identity.account);assert.equal(vault.kdf.iterations,EXTENSION_VAULT_KDF_ITERATIONS);assert.equal(JSON.stringify(vault).includes(SECRET),false);
  assert.deepEqual(unlocked,{secretHex:SECRET,...identity});assert.deepEqual(providerAccountFromVault(vault),{version:1,source:"ynx-wallet-vault",account:identity.account});
  await assert.rejects(()=>unlockEncryptedVault(vault,"incorrect password",webcrypto),error=>error.code==="VAULT_UNLOCK_FAILED");
});

test("vault metadata, ciphertext, identity and weak passwords fail closed",async()=>{
  const vault=await createEncryptedVault({password:PASSWORD,secretHex:SECRET,createdAt:NOW},webcrypto);
  for(const changed of [
    {...vault,account:`0x${"1".repeat(40)}`},
    {...vault,kdf:{...vault.kdf,iterations:1}},
    {...vault,cipher:{...vault.cipher,ciphertext:`A${vault.cipher.ciphertext.slice(1)}`}},
    {...vault,unknown:true},
  ])await assert.rejects(()=>unlockEncryptedVault(changed,PASSWORD,webcrypto));
  assert.throws(()=>parseEncryptedVault({...vault,source:"metamask"}),error=>error.code==="VAULT_TAMPERED");
  await assert.rejects(()=>createEncryptedVault({password:"short",secretHex:SECRET,createdAt:NOW},webcrypto),error=>error.code==="VAULT_PASSWORD_INVALID");
  assert.match(generateExtensionSecret(webcrypto),/^[0-9a-f]{64}$/u);
});
