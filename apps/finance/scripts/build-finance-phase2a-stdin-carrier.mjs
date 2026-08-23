import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [archive,generator,executor,out]=process.argv.slice(2); if(!out) throw new Error('usage: build <archive> <generator> <phase2b> <out>');
const item=(name,mode,path)=>{const b=readFileSync(path);return {name,mode,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),data:b.toString('base64')}};
const frames=[item('archive.tgz','0600',archive),item('generator.sh','0700',generator),item('phase2b.sh','0700',executor)];
const payload=['YNX-FINANCE-P2A-1',...frames.flatMap(f=>[`FRAME ${f.name} ${f.mode} ${f.bytes} ${f.sha256}`,f.data]),'END',''].join('\n');
writeFileSync(out,payload); const all=readFileSync(out); process.stdout.write(JSON.stringify({path:out,bytes:all.length,sha256:createHash('sha256').update(all).digest('hex'),frames})+'\n');
