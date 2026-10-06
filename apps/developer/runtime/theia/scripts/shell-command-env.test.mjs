import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require=createRequire(import.meta.url);require('reflect-metadata');
const {ShellCommandBuilder}=require('@theia/process/lib/common/shell-command-builder');
const {Container,ContainerModule}=require('@theia/core/shared/inversify');
const common=require('@theia/process/lib/common/process-common-module').default;
const {EnvironmentOrderedShellCommandBuilder:Fixed,bindEnvironmentOrderedShellCommandBuilder:bindFixed}=require('../../ynx-workbench/lib/shell-command-env');
const qaEnv={PATH:'/usr/bin:/bin',YNX_IDE_QA_UNUSED:'remove me'};
const run=command=>spawnSync('/bin/bash',['--noprofile','--norc','-c',command],{env:qaEnv,encoding:'utf8'});
test('actual upstream BSD env negative control fails; adapter executes real bash with removed and quoted values', {skip:process.platform!=='darwin'},()=>{
 const options={cwd:'/private/tmp',args:['/bin/bash','--noprofile','--norc','-c','test "${YNX_IDE_QA_UNUSED+x}" != x && test "${YNX_IDE_QA_EMPTY+x}" = x && test "$YNX_IDE_QA_EMPTY" = "" && printf "%s\\n" "$YNX_IDE_QA_VALUE" "$PWD" "$1"','qa','arg with \' quote'],env:{YNX_IDE_QA_VALUE:'spaces \' " $HOME $(false)',YNX_IDE_QA_UNUSED:null,YNX_IDE_QA_EMPTY:''}};
 const before=JSON.stringify(options);const old=run(new ShellCommandBuilder().buildCommand({executable:'/bin/bash'},options));assert.equal(old.status,127);assert.match(old.stderr,/-u/);
 for(const executable of ['/bin/bash','/bin/zsh',undefined]){const result=run(new Fixed().buildCommand({executable},options));assert.equal(result.status,0,result.stderr);assert.deepEqual(result.stdout.split('\n').slice(0,3),[options.env.YNX_IDE_QA_VALUE,'/private/tmp',options.args.at(-1)]);}
 assert.equal(JSON.stringify(options),before);
});
test('same-group ordering and upstream non-Bash output remain identical',()=>{
 const options={args:['program','arg'],env:{QA_A:'a',QA_B:null,QA_C:'c',QA_D:null}};const fixed=new Fixed(),upstream=new ShellCommandBuilder();
 for(const executable of ['cmd.exe','powershell.exe','pwsh'])assert.equal(fixed.buildCommand({executable},options),upstream.buildCommand({executable},options));
 const line=fixed.buildCommand({executable:'/bin/bash'},options);assert.ok(line.indexOf('QA_B')<line.indexOf('QA_D'));assert.ok(line.indexOf('QA_D')<line.indexOf('QA_A'));assert.ok(line.indexOf('QA_A')<line.indexOf('QA_C'));
 for(const env of [undefined,{}, {QA_EMPTY:''}])assert.equal(fixed.buildCommand({}, {...options,env}),upstream.buildCommand({}, {...options,env}));
});
test('real process common binding is replaced as one singleton via owned binding helper',()=>{
 const container=new Container();container.load(common);assert.ok(container.get(ShellCommandBuilder) instanceof ShellCommandBuilder);container.load(new ContainerModule((bind,unbind,isBound,rebind)=>bindFixed(rebind)));const instance=container.get(ShellCommandBuilder);assert.ok(instance instanceof Fixed);assert.equal(container.get(ShellCommandBuilder),instance);
});
