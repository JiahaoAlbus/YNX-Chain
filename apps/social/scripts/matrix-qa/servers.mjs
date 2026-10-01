import {mkdtemp,writeFile,readFile,mkdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {randomBytes} from 'node:crypto';
const image='ghcr.io/element-hq/synapse@sha256:38879c6039381b9b66a2adb11b92c63dd5f7ee6a443b98d1edf10ffe004e17e4';
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8',timeout:90000});if(r.status!==0)throw new Error(`${command} failed (${r.status}): ${(r.stderr||'').replace(/[a-f0-9]{64}/g,'[redacted]').slice(-1000)}`);return r.stdout.trim()}
export async function startServers(){const root=await mkdtemp(join(tmpdir(),'ynx-social-matrix-qa-'));await chmod(root,0o700);const suffix=randomBytes(4).toString('hex'),network=`ynx-social-matrix-${suffix}`,servers=[];run('docker',['network','create',network]);
 run('openssl',['req','-x509','-nodes','-newkey','rsa:2048','-keyout',join(root,'qa-ca.key'),'-out',join(root,'qa-ca.crt'),'-days','2','-subj','/CN=YNX isolated QA CA']);await chmod(join(root,'qa-ca.key'),0o600);
 try{for(const side of ['a','b']){const name=`ynx-social-matrix-${side}-${suffix}`,host=`${side}.ynx-matrix.test`,serverName=host+':8448',data=join(root,side);await mkdir(data,{mode:0o700});
   run('openssl',['req','-new','-nodes','-newkey','rsa:2048','-keyout',join(data,'tls.key'),'-out',join(data,'tls.csr'),'-subj',`/CN=${host}`]);await chmod(join(data,'tls.key'),0o600);
   await writeFile(join(data,'tls.ext'),`subjectAltName=DNS:${host}\n`);run('openssl',['x509','-req','-in',join(data,'tls.csr'),'-CA',join(root,'qa-ca.crt'),'-CAkey',join(root,'qa-ca.key'),'-CAcreateserial','-out',join(data,'tls.crt'),'-days','2','-extfile',join(data,'tls.ext')]);await writeFile(join(data,'qa-ca.crt'),await readFile(join(root,'qa-ca.crt')));
   run('docker',['run','--rm','-v',`${data}:/data`,'-e',`SYNAPSE_SERVER_NAME=${serverName}`,'-e','SYNAPSE_REPORT_STATS=no',image,'generate']);
   const appToken=randomBytes(32).toString('hex'),hsToken=randomBytes(32).toString('hex');
   await writeFile(join(data,'appservice.yaml'),`id: ynx-local-qa\nurl: null\nas_token: '${appToken}'\nhs_token: '${hsToken}'\nsender_localpart: ynx_qa_bridge\nnamespaces:\n  users:\n    - exclusive: true\n      regex: '@ynx1[0-9a-z]{38}:${host.replaceAll('.','\\.')}\\:8448'\n  aliases: []\n  rooms: []\n`,{mode:0o600});
   let config=await readFile(join(data,'homeserver.yaml'),'utf8');config=config.replace(/listeners:[\s\S]*?(?=database:)/,`listeners:\n  - port: 8008\n    tls: false\n    type: http\n    resources:\n      - names: [client]\n        compress: false\n  - port: 8448\n    tls: true\n    type: http\n    resources:\n      - names: [federation]\n        compress: false\n`);
   config=config.replace(/trusted_key_servers:[\s\S]*$/,'trusted_key_servers: []\n');
   config+=`\ntls_certificate_path: /data/tls.crt\ntls_private_key_path: /data/tls.key\nfederation_verify_certificates: true\nfederation_custom_ca_list: [/data/qa-ca.crt]\nfederation_ip_range_blacklist: []\nfederation_domain_whitelist: ['a.ynx-matrix.test:8448', 'b.ynx-matrix.test:8448']\napp_service_config_files: [/data/appservice.yaml]\nenable_registration: false\nsuppress_key_server_warning: true\n`;await writeFile(join(data,'homeserver.yaml'),config,{mode:0o600});
   run('docker',['run','-d','--user','0:0','--name',name,'--network',network,'--network-alias',host,'-p','127.0.0.1::8008','-v',`${data}:/data`,image,'run']);
   const port=run('docker',['inspect','--format','{{(index (index .NetworkSettings.Ports "8008/tcp") 0).HostPort}}',name]);const baseUrl=`http://127.0.0.1:${port}`;servers.push({name,serverName,baseUrl,appToken});
   for(let i=0;i<90;i++){try{if((await fetch(baseUrl+'/_matrix/client/versions')).ok)break}catch{}if(i===89)throw new Error('LOCAL_HOMESERVER_START_FAILED');await new Promise(r=>setTimeout(r,500))}
  }const state={root,image,network,servers};await writeFile(join(root,'runtime.json'),JSON.stringify(state),{mode:0o600});return state;
 }catch(e){for(const s of servers)try{run('docker',['rm','-f',s.name])}catch{}try{run('docker',['network','rm',network])}catch{}throw e}
}
export async function stopServers(state){for(const s of state.servers)run('docker',['rm','-f',s.name]);run('docker',['network','rm',state.network])}
export async function provision(server,account,deviceId){
 const request=async(path,body)=>{const r=await fetch(server.baseUrl+path,{method:'POST',headers:{Authorization:`Bearer ${server.appToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`LOCAL_QA_PROVISION_${r.status}`);return r.json()};
 const userId=`@${account}:${server.serverName}`;
 await request('/_matrix/client/v3/register',{type:'m.login.application_service',username:account,inhibit_login:true});
 const login=await request('/_matrix/client/v3/login',{type:'m.login.application_service',identifier:{type:'m.id.user',user:userId},device_id:deviceId});
 return {protocol:'ynx-social-matrix/v1',account,userId,deviceId,homeserver:server.baseUrl+'/',serverName:server.serverName,accessToken:login.access_token};
}
if(process.argv[2]==='start'){const state=await startServers();console.log(JSON.stringify({runtimePath:join(state.root,'runtime.json'),image,servers:state.servers.map(({name,serverName,baseUrl})=>({name,serverName,baseUrl}))}))}
