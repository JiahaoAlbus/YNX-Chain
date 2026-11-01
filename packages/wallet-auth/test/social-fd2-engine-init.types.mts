import type {SocialFD2InitializationDATA,SocialFD2EngineCommitBodyDATA} from '../src/social-fd2-engine-init.js';
import {decodeSocialFD2InitializationContextDATA} from '../src/social-fd2-engine-init.js';
declare const binding:SocialFD2InitializationDATA;
// @ts-expect-error old v1 variant must not accept the set
const old:1=binding.version;
// @ts-expect-error only five row AAD strings
const short:SocialFD2InitializationDATA={...binding,aads:['a','b','c','d']};
// @ts-expect-error no new outer crypto/version
const wrong:SocialFD2EngineCommitBodyDATA={version:2};
const facts=decodeSocialFD2InitializationContextDATA(new Uint8Array(3392),new Uint8Array(416));
// @ts-expect-error DATA cannot prove actual Source
const source:true=facts.ActualSource;
// @ts-expect-error DATA cannot prove MAC
const mac:true=facts.MACVerified;
