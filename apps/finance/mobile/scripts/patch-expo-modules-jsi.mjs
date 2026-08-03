import {readFile,writeFile} from 'node:fs/promises';

const path=new URL('../node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift',import.meta.url);
const before='abs(milliseconds) <= maxJavaScriptDateMilliseconds';
const after='milliseconds.magnitude <= maxJavaScriptDateMilliseconds';
const source=await readFile(path,'utf8');
if(source.includes(after))process.exit(0);
if(!source.includes(before))throw new Error('ExpoModulesJSI Date guard changed; review and remove/update the Swift 6.2 compatibility patch');
await writeFile(path,source.replace(before,after));
console.log('Applied ExpoModulesJSI Swift 6.2 Date magnitude compatibility patch');
