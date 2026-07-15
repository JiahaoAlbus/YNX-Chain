import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Principal, Role } from './types.js';

interface UserConfig { username:string; role:Role; passwordHash:string }
export function hashPassword(password:string,salt='ynx-monitor-v1') { return scryptSync(password,salt,32).toString('hex'); }
export function loadUsers():UserConfig[] {
  if(process.env.YNX_MONITOR_USERS){const users=JSON.parse(process.env.YNX_MONITOR_USERS) as UserConfig[];if(!Array.isArray(users)||!users.length||users.some(user=>!user.username||!['viewer','operator'].includes(user.role)||!/^[a-f0-9]{64}$/.test(user.passwordHash)))throw new Error('YNX_MONITOR_USERS must be a non-empty, valid JSON user array');if(new Set(users.map(user=>user.username)).size!==users.length)throw new Error('YNX_MONITOR_USERS usernames must be unique');return users;}
  if(process.env.YNX_MONITOR_DEV_USERS==='1') return [{username:'operator',role:'operator',passwordHash:hashPassword('operator-local')},{username:'viewer',role:'viewer',passwordHash:hashPassword('viewer-local')}];
  throw new Error('YNX_MONITOR_USERS is required; local demo users require explicit YNX_MONITOR_DEV_USERS=1');
}
export function verifyUser(users:UserConfig[],username:string,password:string){const user=users.find(x=>x.username===username);if(!user)return undefined;const actual=Buffer.from(hashPassword(password),'hex');const expected=Buffer.from(user.passwordHash,'hex');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return undefined;return {username:user.username,role:user.role} as Principal;}
export function createToken(principal:Principal,secret:string,ttlSeconds=3600){const payload=Buffer.from(JSON.stringify({...principal,exp:Math.floor(Date.now()/1000)+ttlSeconds})).toString('base64url');return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;}
export function verifyToken(token:string,secret:string):Principal|undefined{try{const [payload,sig]=token.split('.');if(!payload||!sig)return;const expected=createHmac('sha256',secret).update(payload).digest('base64url');if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return;const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(data.exp<Math.floor(Date.now()/1000)||!['viewer','operator'].includes(data.role)||typeof data.username!=='string')return;return {username:data.username,role:data.role};}catch{return undefined}}
declare global { namespace Express { interface Request { principal?:Principal } } }
export function auth(secret:string){return(req:Request,res:Response,next:NextFunction)=>{const token=req.header('authorization')?.replace(/^Bearer /,'');const principal=token&&verifyToken(token,secret);if(!principal)return res.status(401).json({error:'authentication_required'});req.principal=principal;next();};}
export function operator(req:Request,res:Response,next:NextFunction){if(req.principal?.role!=='operator')return res.status(403).json({error:'operator_role_required'});next();}
