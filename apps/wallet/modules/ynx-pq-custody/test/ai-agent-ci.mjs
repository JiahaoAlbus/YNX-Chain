// Owner-scoped CI entry; parent normal CI may call this after matching suppliers.
import fs from'node:fs';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),pins=JSON.parse(fs.readFileSync(root+'/native/ai-agent/INPUT_PINS.json'));
for(const p of Object.values(pins))if(p&&typeof p==='object'&&p.path){const bytes=fs.readFileSync(p.path);if(bytes.length!==p.bytes||createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error('AI_AGENT_SUPPLIER_DRIFT:'+p.path);}
if(process.argv.includes('--pins-only')){console.log('Agent7 current supplier pins verified; activation is not claimed');process.exit(0);}
for(const test of ['ai-agent-controls.mjs','ai-agent-fixed-math-controls.mjs','ai-agent-platform.mjs']){const r=spawnSync(process.execPath,[root+'/test/'+test],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
if(!pins.pairedCaptureGetter||!pins.actualFixedMathH)throw Error('AI_AGENT_MATCHED_CAPTURE_AND_FIXED_MATH_BODY_NOT_SUPPLIED');

if(process.env.YNX_AI_AGENT_NORMAL_COMPOSITION_CI==='1'){const r=spawnSync(process.execPath,[root+'/test/ai-agent-normal-composition.mjs'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
