#!/usr/bin/env node
// Bounded read-only RPC diagnostics. Never admits a transaction or Faucet grant.
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summarize(samples) {
  const values = samples.map(s => s.totalMs).sort((a, b) => a - b);
  const percentile = p => values.length ? values[Math.ceil(values.length * p) - 1] : null;
  return { count: samples.length, errors: samples.filter(s => !s.ok).length,
    errorRate: samples.length ? samples.filter(s => !s.ok).length / samples.length : null,
    p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: values.at(-1) ?? null,
    reusedConnections: samples.filter(s => s.reusedSocket).length };
}

export function validateTarget(value) {
  const u = new URL(value);
  const publicHost = ['rpc-testnet.ynxweb4.com', 'rpc.ynxweb4.com'].includes(u.hostname);
  const local = ['127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
      !(publicHost && u.protocol === 'https:' && !u.port || local && u.protocol === 'http:')) {
    throw new Error('Only canonical/legacy HTTPS RPC origins or explicit loopback HTTP are allowed');
  }
  return u.origin;
}

export function readOnce(origin, method, hash, agent, id, timeoutMs = 12000) {
  if (!['health', 'eth_chainId', 'eth_blockNumber', 'eth_getTransactionReceipt'].includes(method)) {
    throw new Error('Read method not allowlisted');
  }
  const body = method === 'health' ? null : JSON.stringify({jsonrpc: '2.0', id, method,
    params: method === 'eth_getTransactionReceipt' ? [hash] : []});
  const u = new URL(method === 'health' ? '/health' : '/evm', validateTarget(origin));
  const transport = u.protocol === 'https:' ? https : http;
  const started = performance.now(), timings = {};
  return new Promise(resolve => {
    let settled = false, timer;
    const done = value => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({origin, method, id, startedAt, ...timings, totalMs: performance.now() - started, ...value});
    };
    const startedAt = new Date().toISOString();
    const req = transport.request(u, {method: body ? 'POST' : 'GET', agent,
      headers: body ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)} : {}}, res => {
      timings.ttfbMs = performance.now() - started;
      timings.upstreamWaitMs = timings.ttfbMs - (timings.readyMs ?? timings.socketMs ?? 0);
      let data = '';
      res.on('data', chunk => { data += chunk; if (data.length > 131072) req.destroy(new Error('response too large')); });
      res.on('error', err => done({ok:false,error:err.message,status:res.statusCode,reusedSocket:req.reusedSocket}));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const envelope = body ? json.jsonrpc === '2.0' && json.id === id && !json.error : json.ok === true;
          const valid = method === 'eth_chainId' ? json.result === '0x1917' :
            method === 'eth_blockNumber' ? /^0x[0-9a-f]+$/.test(json.result) :
            method === 'eth_getTransactionReceipt' ? json.result?.transactionHash === hash && json.result?.status === '0x1' : true;
          done({ok:res.statusCode === 200 && envelope && valid, status:res.statusCode,
            reusedSocket:req.reusedSocket, result:body ? json.result : {ok:json.ok}, rpcError:json.error});
        } catch(err) { done({ok:false,status:res.statusCode,error:err.message,reusedSocket:req.reusedSocket}); }
      });
    });
    req.on('socket', socket => {
      timings.socketMs = performance.now() - started;
      if (!socket.connecting) timings.readyMs = timings.socketMs;
      else {
        socket.once('lookup', () => {timings.dnsMs = performance.now() - started;});
        socket.once('connect', () => {timings.tcpMs = performance.now() - started; if (u.protocol === 'http:') timings.readyMs = timings.tcpMs;});
        socket.once('secureConnect', () => {timings.readyMs = performance.now() - started;});
      }
    });
    req.on('error', err => done({ok:false,error:err.message,reusedSocket:req.reusedSocket}));
    timer = setTimeout(() => req.destroy(new Error('total deadline exceeded')), timeoutMs);
    req.end(body);
  });
}

export async function run({targets, receipt, rounds = 3, users = 3}) {
  targets = targets.map(validateTarget);
  if (!/^0x[0-9a-f]{64}$/.test(receipt)) throw new Error('Existing successful receipt hash required');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 6 || !Number.isInteger(users) || users < 1 || users > 3 || targets.length < 1 || targets.length > 2) throw new Error('Bounded probe: 1..6 rounds, 1..3 users, 1..2 targets');
  const samples = [], startedAt = new Date().toISOString(); let id = 0;
  for (const mode of ['fresh', 'keepalive']) {
    const agents = targets.map(origin => Array.from({length:users}, () => new (origin.startsWith('https:') ? https : http).Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1})));
    try {
      for (let round=0; round<rounds; round++) {
        for (const method of ['health','eth_chainId','eth_blockNumber','eth_getTransactionReceipt']) {
          const wave = await Promise.all(targets.flatMap((origin, target) => Array.from({length:users}, async (_, user) => ({mode,round,user,...await readOnce(origin,method,receipt,mode === 'fresh' ? false : agents[target][user],++id)}))));
          samples.push(...wave);
          process.stderr.write(`${mode} round=${round+1} ${method}: ${wave.filter(s=>s.ok).length}/${wave.length}, max=${Math.max(...wave.map(s=>s.totalMs)).toFixed(1)}ms\n`);
          await new Promise(resolve => setTimeout(resolve,250));
        }
      }
    } finally { agents.flat().forEach(a=>a.destroy()); }
  }
  const groups = {};
  for (const sample of samples) { const key=[sample.origin,sample.mode,sample.method].join('|'); (groups[key] ??= []).push(sample); }
  return {schemaVersion:1,kind:'bounded-readonly-rpc-latency',startedAt,completedAt:new Date().toISOString(),
    protocol:'HTTP/1.1; certificate validation enabled for HTTPS; loopback HTTP has no TLS',targets,rounds,users,maximumConcurrency:targets.length*users,
    safety:{transactionSubmissions:0,faucetAdmissions:0,retries:0,globalAvailabilityVerified:false,multiRegionVerified:false,performanceSLOVerified:false},
    interpretation:'Latency includes errors and cold samples; upstreamWaitMs excludes observed local connection setup but is not server instrumentation. Independent simulated clients, not funded accounts. Receipt is pre-existing.',
    summary:summarize(samples),groups:Object.fromEntries(Object.entries(groups).map(([key,value])=>[key,summarize(value)])),samples};
}

if (process.argv[1] && (process.argv[1] === '-' || import.meta.url === pathToFileURL(process.argv[1]).href)) {
  const args = process.argv.slice(2); const value = key => { const i=args.indexOf(key); return i<0 ? undefined : args[i+1]; };
  const result = await run({targets:(value('--targets') ?? 'https://rpc-testnet.ynxweb4.com,https://rpc.ynxweb4.com').split(','),receipt:value('--receipt'),rounds:Number(value('--rounds') ?? 3),users:Number(value('--users') ?? 3)});
  const output = value('--output');
  if (output) writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify(output ? {output,summary:result.summary,groups:result.groups} : result,null,2)+'\n');
  if (result.summary.errors) process.exitCode=1;
}
