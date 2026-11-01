// CI/test identity only. This never installs, signs, acquires Source or grants authority.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [major,minor,patch]=process.versions.node.split('.').map(Number);
if(major!==24||minor<18||minor===18&&patch<1)throw Error('SDK_INTERFACE_CI_REQUIRES_NODE_24_AT_LEAST_24_18_1');
const archive=readFileSync(new URL('../testdata/ynx-batch-v01-candidate-0.1.0-candidate.2.tgz',import.meta.url));
if(archive.length!==17804||createHash('sha256').update(archive).digest('hex')!=='401eca733083c2ac67998295c54f09f0553760b99eaf0adf9ef1e1a85b4cbd0b')throw Error('SDK_INTERFACE_CI_PROVIDER_ARCHIVE_CHANGED');
for(const [name,version]of Object.entries({'@ynx/batch-v01-candidate':'0.1.0-candidate.2','@noble/post-quantum':'0.6.1','@noble/ciphers':'2.2.0','@noble/curves':'2.2.0','@noble/hashes':'2.2.0'})){
 const meta=JSON.parse(readFileSync(new URL('../node_modules/'+name+'/package.json',import.meta.url)));
 if(meta.name!==name||meta.version!==version)throw Error('SDK_INTERFACE_CI_DEPENDENCY_CHANGED:'+name);
}
console.log('SDK interface CI fixed provider/dependency metadata verified; no Source or account authority acquired');
