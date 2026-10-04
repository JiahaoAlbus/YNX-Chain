import {resolve} from "node:path";
import {createCardStaticEnvelope,envelopeArguments} from './card-static-envelope.mjs';

const root=resolve(import.meta.dirname,"..");
const {source,envelope}=envelopeArguments(process.argv.slice(2),root);
const manifest=createCardStaticEnvelope(root,source,envelope);
console.log(`Created exact static envelope with ${manifest.files.length} files at ${envelope}`);
