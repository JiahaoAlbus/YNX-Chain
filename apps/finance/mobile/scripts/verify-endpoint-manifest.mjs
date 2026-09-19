import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const path=new URL('../contract/public-endpoint-manifest.json',import.meta.url);
const manifest=JSON.parse(await readFile(path,'utf8'));
const expected='3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5';
const payload={...manifest};delete payload.integrity;
const actual=createHash('sha256').update(JSON.stringify(payload),'utf8').digest('hex');
if(manifest.integrity?.payloadSha256!==expected||actual!==expected)throw new Error(`Endpoint manifest SHA-256 mismatch: expected ${expected}, got ${actual}`);
if(manifest.sourceCommit!=='fa0ffd9bbbcc831438078be8e19cebff51b07e5e')throw new Error('Endpoint manifest source commit does not match accepted contract.');
process.stdout.write(`Finance endpoint manifest verified ${actual}\n`);
