export type Role='viewer'|'operator';
export interface Session { token:string; principal:{username:string;role:Role} }
export async function request<T>(path:string,session?:Session,init?:RequestInit):Promise<T>{const response=await fetch(path,{...init,headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.token}`}:{ }),...init?.headers}});const body=await response.json().catch(()=>({error:`HTTP ${response.status}`}));if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);return body;}
export async function login(username:string,password:string){return request<Session>('/ops/login',undefined,{method:'POST',body:JSON.stringify({username,password})});}
