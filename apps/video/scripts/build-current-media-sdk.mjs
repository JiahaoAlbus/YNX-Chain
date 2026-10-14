import {buildCurrentMediaSdk} from './current-media-sdk.mjs';
const [root,output,profile='browser']=process.argv.slice(2);
if(!root||!output)throw Error('Pass exact isolated Media source root and new artifact output directory');
await buildCurrentMediaSdk(root,output,profile,profile==='browser'?{filename:'product-session-sdk-r9.js',registryFilename:'product-session-registry-r9.json',sourceFilename:'product-session-sdk-r9-source.json'}:{});
