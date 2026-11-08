import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),r=spawnSync(process.execPath,['--test','scripts/test/task-grant-target-host-role.test.mjs'],{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('TASK_GRANT_TARGET_HOST_ROLE_DELTA_FAILED:'+r.status);
