import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Permission, Principal, Role } from './types.js';

interface UserConfig { username:string; role:Role; passwordHash:string }

const roles:readonly Role[] = [
  'viewer',
  'operator',
  'incident_commander',
  'backup_recovery',
  'security_reviewer',
];

const rolePermissions:Record<Role,readonly Permission[]> = {
  viewer: [],
  // Transitional broad role retained for existing deployments. New assignments
  // should use one of the scoped roles below.
  operator: [
    'incident:create',
    'incident:manage',
    'incident:recovery_verify',
    'incident:postmortem',
    'alert:acknowledge',
    'backup:record',
    'backup:verify',
    'rollback:propose',
    'rollback:verify',
    'automation:propose',
    'automation:review',
  ],
  incident_commander: [
    'incident:create',
    'incident:manage',
    'incident:postmortem',
    'alert:acknowledge',
  ],
  backup_recovery: [
    'incident:recovery_verify',
    'backup:record',
    'rollback:propose',
    'automation:propose',
  ],
  security_reviewer: ['alert:acknowledge','backup:verify','rollback:verify','automation:review'],
};

function isRole(value:unknown):value is Role {
  return typeof value === 'string' && roles.includes(value as Role);
}

export function permissionsForRole(role:Role):readonly Permission[] {
  return rolePermissions[role];
}

export function hashPassword(password:string,salt='ynx-monitor-v1') {
  return scryptSync(password,salt,32).toString('hex');
}

export function loadUsers():UserConfig[] {
  if(process.env.YNX_MONITOR_USERS){
    const users=JSON.parse(process.env.YNX_MONITOR_USERS) as UserConfig[];
    if(!Array.isArray(users)||!users.length||users.some(user=>!user.username||!isRole(user.role)||!/^[a-f0-9]{64}$/.test(user.passwordHash))) {
      throw new Error('YNX_MONITOR_USERS must be a non-empty, valid JSON user array');
    }
    if(new Set(users.map(user=>user.username)).size!==users.length)throw new Error('YNX_MONITOR_USERS usernames must be unique');
    return users;
  }
  if(process.env.YNX_MONITOR_DISABLE_PASSWORD_LOGIN==='1')return [];
  if(process.env.YNX_MONITOR_DEV_USERS==='1') return [
    {username:'operator',role:'operator',passwordHash:hashPassword('operator-local')},
    {username:'viewer',role:'viewer',passwordHash:hashPassword('viewer-local')},
  ];
  throw new Error('YNX_MONITOR_USERS is required; local demo users require explicit YNX_MONITOR_DEV_USERS=1');
}

export function verifyUser(users:UserConfig[],username:string,password:string){
  const user=users.find(x=>x.username===username);
  if(!user)return undefined;
  const actual=Buffer.from(hashPassword(password),'hex');
  const expected=Buffer.from(user.passwordHash,'hex');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return undefined;
  return {username:user.username,role:user.role} as Principal;
}

export function createToken(principal:Principal,secret:string,ttlSeconds=3600){
  const payload=Buffer.from(JSON.stringify({...principal,exp:Math.floor(Date.now()/1000)+ttlSeconds})).toString('base64url');
  return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
}

export function createCsrfToken(sessionToken:string,secret:string){
  return createHmac('sha256',secret).update(`ynx-monitor-csrf:${sessionToken}`).digest('base64url');
}

export function verifyToken(token:string,secret:string):Principal|undefined{
  try{
    const [payload,sig]=token.split('.');
    if(!payload||!sig)return;
    const expected=createHmac('sha256',secret).update(payload).digest('base64url');
    if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString());
    if(data.exp<Math.floor(Date.now()/1000)||!isRole(data.role)||typeof data.username!=='string')return;
    return {username:data.username,role:data.role};
  }catch{return undefined}
}

declare global { namespace Express { interface Request { principal?:Principal; sessionToken?:string } } }

export function auth(secret:string){
  return(req:Request,res:Response,next:NextFunction)=>{
    const token=req.header('authorization')?.replace(/^Bearer /,'');
    const principal=token&&verifyToken(token,secret);
    if(!principal)return res.status(401).json({error:'authentication_required'});
    req.principal=principal;
    req.sessionToken=token;
    next();
  };
}

export function requireMutationProtection(secret:string,allowedOrigins:readonly string[]){
  const origins=new Set(allowedOrigins.map(value=>new URL(value).origin));
  if(!origins.size)throw new Error('At least one YNX Monitor operator origin is required');
  return(req:Request,res:Response,next:NextFunction)=>{
    if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
    const origin=req.header('origin');
    if(!origin)return res.status(403).json({error:'origin_required'});
    let normalized:string;
    try{normalized=new URL(origin).origin;}catch{return res.status(403).json({error:'origin_not_allowed'});}
    if(!origins.has(normalized))return res.status(403).json({error:'origin_not_allowed'});
    const csrf=req.header('x-ynx-csrf-token');
    if(!csrf||!req.sessionToken)return res.status(403).json({error:'csrf_token_required'});
    const actual=Buffer.from(csrf),expected=Buffer.from(createCsrfToken(req.sessionToken,secret));
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(403).json({error:'csrf_token_invalid'});
    next();
  };
}

export function requirePermission(permission:Permission){
  return(req:Request,res:Response,next:NextFunction)=>{
    const principal=req.principal;
    if(!principal||!permissionsForRole(principal.role).includes(permission)) {
      return res.status(403).json({error:'permission_required',requiredPermission:permission});
    }
    next();
  };
}
