// Frozen Main bodies plus SDK entry source gates only; no Native compilation,
// signing, Source, consent, archive read, user data or runtime qualification.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';
const root=new URL('../../../',import.meta.url);
const pins=[
  {
    "path": "apps/wallet-desktop/native/original-artifact-publisher-store.h",
    "bytes": 6364,
    "sha256": "f7231380d0674be6f843809bc123b66ea658af79edf04fa35be0404f35c223bd"
  },
  {
    "path": "apps/wallet-desktop/native/original-artifact-publisher-store.mm",
    "bytes": 41258,
    "sha256": "b5ddc4174abfe1959a4066d90fc8f28aa603a9a6c2d8f20520cf2ec66788552b"
  },
  {
    "path": "apps/wallet-desktop/native/original-artifact-publisher-binding.inc.mm",
    "bytes": 17154,
    "sha256": "bd2b7aae7bbd108b2c2775f19e1621e9617fc19d70c2e9bad9fd576ee71d299d"
  },
  {
    "path": "apps/wallet-desktop/native/original-project-control-journal.h",
    "bytes": 705,
    "sha256": "f2ce1185a38a3e534dcc0478eb0fddae04839cb8b3b4377fffc3c7cff8a5dd28"
  },
  {
    "path": "apps/wallet-desktop/native/original-project-control-journal.mm",
    "bytes": 4783,
    "sha256": "fa02c314dd925d0bd5ae3a7e636cf58c682be9a8adc8a434354dd88995c981e6"
  },
  {
    "path": "apps/wallet-desktop/native/original-project-control-review.h",
    "bytes": 2075,
    "sha256": "884af35345d974b0ec168daec93ee77e9464f40aed9a8a18c340d39ffaa6f332"
  },
  {
    "path": "apps/wallet-desktop/native/original-project-control-review.mm",
    "bytes": 41421,
    "sha256": "d6f8ab5647912e52a03a011c064ddc5c88be7f9a869184f019919e631690ac8f"
  },
  {
    "path": "apps/wallet-desktop/native/original-project-control-binding.inc.mm",
    "bytes": 10298,
    "sha256": "49c95e1be1d0849dff878ddbb0e19fd9ee86d8a481b8998a4f57daff5e7feada"
  },
  {
    "path": "apps/wallet-desktop/native/original-project-control-cabi.h",
    "bytes": 4180,
    "sha256": "a85524f65a20dbeb01d8c79ce2ce98636736e54b9605e0fc4843a593bc87bc96"
  },
  {
    "path": "apps/wallet-desktop/native/ynx_project_control.h",
    "bytes": 4420,
    "sha256": "98c4f5fa607d6a1e87b5ea091c7110288aee7f8ac9ff5a901f98e1c2990ca5af"
  },
  {
    "path": "apps/wallet-desktop/native/original-artifact-publisher-cabi.h",
    "bytes": 4734,
    "sha256": "f97eb8cafb4151113cd38a17a73a95d4534c1915986d1fa1ee15ada30964dd8a"
  },
  {
    "path": "apps/wallet-desktop/native/ynx_artifact_release.h",
    "bytes": 5089,
    "sha256": "1da905e0b38581ad34a9cf995c36f8d368425df9242a35f4e49d7b41c8100616"
  }
];
const source=path=>readFileSync(new URL(path,root),'utf8');
const entry=source('apps/wallet-desktop/native/original-auth-identity-node.mm'),artifact=source('apps/wallet-desktop/native/original-artifact-publisher-binding.inc.mm');
const directInclude='#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL)\n#if YNX_ORIGINAL_WALLET_PROJECT_CONTROL != 1\n#error "YNX_ORIGINAL_WALLET_PROJECT_CONTROL_REQUIRES_ONE"\n#endif\n#if !defined(YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING)\n#include "original-project-control-binding.inc.mm"\n#endif\n#endif';
const directRegister='#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL) && !defined(YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING)\n if(!RegisterOriginalProjectControlBinding(env,exports))return nullptr;\n#endif';
test('SDK CONTROL source entry requires exact flag1 and includes before main-thread guarded registration',()=>{assert(entry.includes(directInclude));assert(entry.includes(directRegister));assert(entry.indexOf(directInclude)<entry.indexOf('static napi_value Register('));assert(entry.indexOf('if(!pthread_main_np())')<entry.indexOf(directRegister));assert(entry.indexOf(directRegister)<entry.indexOf('return RegisterOriginalIDEAuthIdentityBinding'));});
test('CONTROL absent has no unguarded entry export and co-resident Artifact owns the single registration',()=>{const remaining=entry.replace(directInclude,'').replace(directRegister,'');assert(!remaining.includes('RegisterOriginalProjectControlBinding'));assert(!remaining.includes('#include "original-project-control-binding.inc.mm"'));assert(!remaining.includes('captureOriginalWalletProjectControlReview'));assert(artifact.includes('#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL) && YNX_ORIGINAL_WALLET_PROJECT_CONTROL == 1\n#import "original-project-control-binding.inc.mm"\n#endif'));assert(artifact.includes('#if defined(YNX_ORIGINAL_WALLET_PROJECT_CONTROL) && YNX_ORIGINAL_WALLET_PROJECT_CONTROL == 1\n return RegisterOriginalProjectControlBinding(env,exports);\n#else\n return true;\n#endif'));});
test('Main c132 production bodies and both fixed-purpose headers remain exact and real local includes resolve',()=>{for(const p of pins){const raw=readFileSync(new URL(p.path,root));assert.equal(raw.length,p.bytes,p.path);assert.equal(createHash('sha256').update(raw).digest('hex'),p.sha256,p.path);for(const m of raw.toString().matchAll(/^\s*#(?:import|include)\s*"([^"\n]+)"/gm)){const local=new URL(m[1],new URL(p.path,root));const supplier=new URL('packages/wallet-auth/native/'+m[1],root);assert(existsSync(local)||existsSync(supplier),p.path+' -> '+m[1]);}}});
