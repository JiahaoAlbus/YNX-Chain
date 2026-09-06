import assert from "node:assert/strict";
import test from "node:test";
import {webcrypto} from "node:crypto";
import {EXTENSION_VAULT_KDF_ITERATIONS,createEncryptedVault,extensionIdentity,generateExtensionSecret,parseEncryptedVault,providerAccountFromVault,unlockEncryptedVault} from "../src/extension-vault.js";

const SECRET=`${"00".repeat(31)}01`,PASSWORD="correct horse battery staple",NOW="2026-08-22T05:00:00.000Z";

// Created by the original version 1 writer before the storage-order fix, using only the public fixture above.
const ORIGINAL_V1={version:1,source:"ynx-wallet-vault",account:"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",publicKey:"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",kdf:{name:"PBKDF2",hash:"SHA-256",iterations:600000,salt:"Eq5r_Ykl-PScouFnUzWmyQ"},cipher:{name:"AES-GCM",iv:"VNLk2q6od0qqxWdv",ciphertext:"C-zJTuK_CmKYocL3M_lYYWoDcSi1ANHqGsoDfDR-U_W6amSeb0byc6XJDKHViCfMIKfSMVxdCYxbQ9nydFkJ7R4z2p0BiWRHuEsayoHW3BB7Hn4IG13mO_AbmZRA6j_3r5eMSrV2wLNvYy0A"},createdAt:NOW};
function storageOrder(value){return value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,storageOrder(value[key])])):value}

test("persisted version 1 vault survives browser storage object-key reordering without rewriting ciphertext",async()=>{
  const persisted=storageOrder(ORIGINAL_V1),before=JSON.stringify(persisted);
  assert.deepEqual(Object.keys(persisted.kdf),["hash","iterations","name","salt"]);
  assert.equal((await unlockEncryptedVault(ORIGINAL_V1,PASSWORD,webcrypto)).secretHex,SECRET);
  assert.equal((await unlockEncryptedVault(persisted,PASSWORD,webcrypto)).secretHex,SECRET);
  assert.equal(JSON.stringify(persisted),before);
  assert.deepEqual(parseEncryptedVault(persisted).cipher,ORIGINAL_V1.cipher);
  await assert.rejects(()=>unlockEncryptedVault(persisted,"incorrect password",webcrypto),error=>error.code==="VAULT_UNLOCK_FAILED");
  await assert.rejects(()=>unlockEncryptedVault({...persisted,createdAt:"2026-08-23T05:00:00.000Z"},PASSWORD,webcrypto),error=>error.code==="VAULT_UNLOCK_FAILED");
  await assert.rejects(()=>unlockEncryptedVault({...persisted,kdf:{...persisted.kdf,salt:"A"+persisted.kdf.salt.slice(1)}},PASSWORD,webcrypto),error=>error.code==="VAULT_UNLOCK_FAILED");
});

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
