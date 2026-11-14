import fs from 'node:fs';import path from 'node:path';
const expected='openssl_conf = init\n[init]\nproviders = providers\n[providers]\ndefault = default_section\n[default_section]\nactivate = 1\n';
export function validateQAOpenSSLInputs(conf,modules){
 for(const p of [conf,modules])if(!path.isAbsolute(p)||fs.realpathSync(p)!==p)throw Error('QA_OPENSSL_REAL_PATH_REQUIRED');
 const configStat=fs.lstatSync(conf),moduleStat=fs.lstatSync(modules);
 if(!configStat.isFile()||configStat.isSymbolicLink()||!moduleStat.isDirectory()||moduleStat.isSymbolicLink())throw Error('QA_OPENSSL_INPUT_TYPE');
 if(fs.readFileSync(conf,'utf8')!==expected)throw Error('QA_OPENSSL_CONFIG_UNEXPECTED');
 if(fs.readdirSync(modules).length)throw Error('QA_OPENSSL_MODULES_NOT_EMPTY');
 return Object.freeze({OPENSSL_CONF:conf,OPENSSL_MODULES:modules});
}
