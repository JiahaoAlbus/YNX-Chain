export type Role='viewer'|'operator'|'incident_commander'|'backup_recovery'|'security_reviewer';
export type Permission=
  |'incident:create'
  |'incident:manage'
  |'incident:recovery_verify'
  |'incident:postmortem'
  |'alert:acknowledge'
  |'backup:record'
  |'backup:verify'
  |'rollback:propose'
  |'rollback:verify';
export interface Session { token:string; csrfToken:string; principal:{username:string;role:Role}; permissions?:Permission[] }

const fallbackPermissions:Record<Role,readonly Permission[]>={
  viewer:[],
  operator:['incident:create','incident:manage','incident:recovery_verify','incident:postmortem','alert:acknowledge','backup:record','backup:verify','rollback:propose','rollback:verify'],
  incident_commander:['incident:create','incident:manage','incident:postmortem','alert:acknowledge'],
  backup_recovery:['incident:recovery_verify','backup:record','rollback:propose'],
  security_reviewer:['alert:acknowledge','backup:verify','rollback:verify'],
};

export function can(session:Session,permission:Permission){
  return (session.permissions??fallbackPermissions[session.principal.role]).includes(permission);
}

export async function request<T>(path:string,session?:Session,init?:RequestInit):Promise<T>{const method=(init?.method??'GET').toUpperCase(),mutation=!['GET','HEAD','OPTIONS'].includes(method);const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.token}`,...(mutation?{'X-YNX-CSRF-Token':session.csrfToken}:{})}:{ }),...init?.headers}});const body=await response.json().catch(()=>({error:`HTTP ${response.status}`}));if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);return body;}
export async function login(username:string,password:string){return request<Session>('/ops/login',undefined,{method:'POST',body:JSON.stringify({username,password})});}
