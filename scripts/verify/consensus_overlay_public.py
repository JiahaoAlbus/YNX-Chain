#!/usr/bin/env python3
"""Normal overlay public-input binding and finite read-only remote verifier."""
import base64
import hashlib
import inspect
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

ROLES=['primary','singapore','silicon-valley','seoul']
ADDRESSES={role:'10.77.42.'+str(i+1) for i,role in enumerate(ROLES)}
RECORD_FIELDS={'version','purpose','role','publicEndpoint','overlayAddress','listenPort','wireGuardPublicKey','custodyBoundary'}

def unique_pairs(pairs):
    value={}
    for k,v in pairs:
        if k in value:raise ValueError('duplicate public field')
        value[k]=v
    return value

def file_identity(s):
    return s.st_dev,s.st_ino,s.st_mode,s.st_nlink,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns

def read_public(path,maximum,pin):
    path=Path(path)
    assert path.is_absolute() and os.path.realpath(path)==str(path)
    before=os.lstat(path)
    assert stat.S_ISREG(before.st_mode) and before.st_nlink==1 and not before.st_mode&0o022
    assert 0<before.st_size<=maximum and re.fullmatch('[0-9a-f]{64}',pin) and pin!='0'*64
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    try:
        assert file_identity(before)==file_identity(os.fstat(fd))
        data=b''
        while len(data)<=maximum:
            b=os.read(fd,min(65536,maximum+1-len(data)))
            if not b:break
            data+=b
        assert len(data)==before.st_size and hashlib.sha256(data).hexdigest()==pin
        assert file_identity(before)==file_identity(os.fstat(fd))==file_identity(os.lstat(path))
        assert os.path.realpath(path)==str(path)
        return json.loads(data,object_pairs_hook=unique_pairs)
    finally:os.close(fd)

def public_record(record,role):
    assert isinstance(record,dict) and set(record)==RECORD_FIELDS
    assert record['version']==1 and record['purpose']=='ynx-consensus-private-overlay-public-keys-only'
    assert record['role']==role and record['overlayAddress']==ADDRESSES[role]
    assert record['custodyBoundary']=='owner-controlled-host-local'
    assert type(record['listenPort']) is int and 1024<=record['listenPort']<=65535
    octets=list(ipaddress.IPv4Address(record['publicEndpoint']).packed)
    assert octets[0] not in (0,10,127,224,255) and octets[:2]!=[169,254] and octets[:2]!=[192,168]
    assert not (octets[0]==172 and 16<=octets[1]<=31)
    key=record['wireGuardPublicKey'];assert isinstance(key,str)
    decoded=base64.b64decode(key,validate=True)
    assert len(decoded)==32 and base64.b64encode(decoded).decode()==key
    return record

def load_expectations(package,pin,role):
    assert role in ROLES
    root=Path(package);assert root.is_absolute() and os.path.realpath(root)==str(root)
    manifest=read_public(root/'package-manifest.json',65536,pin)
    assert set(manifest)=={'version','purpose','interface','cidr','roles','files'}
    assert manifest['version']==1 and manifest['purpose']=='ynx-consensus-private-overlay'
    assert manifest['interface']=='ynxwg0' and manifest['cidr']=='10.77.42.0/24' and manifest['roles']==ROLES
    expected_files={f'roles/{r}/{n}' for r in ROLES for n in ('ynx-consensus-overlay-up','ynx-consensus-overlay.service','role-manifest.json')}
    assert set(manifest['files'])==expected_files
    records={};documents={}
    for r in ROLES:
        rel=f'roles/{r}/role-manifest.json'
        # Only public node/peers documents are read. Never read WG up/config,
        # systemd unit bodies or any role's wireguard.key.
        doc=read_public(root/rel,65536,manifest['files'][rel])
        assert isinstance(doc,dict) and set(doc)=={'version','purpose','node','peers'}
        assert doc['version']==1 and doc['purpose']=='ynx-consensus-private-overlay'
        records[r]=public_record(doc['node'],r);documents[r]=doc
    assert len({v['wireGuardPublicKey'] for v in records.values()})==4
    assert len({(v['publicEndpoint'],v['listenPort']) for v in records.values()})==4
    for r,doc in documents.items():
        assert isinstance(doc['peers'],list) and len(doc['peers'])==3
        peers={}
        for peer in doc['peers']:
            pr=peer['role'];assert pr in ROLES and pr!=r and pr not in peers
            peers[pr]=public_record(peer,pr)
        assert peers=={pr:records[pr] for pr in ROLES if pr!=r}
    return {'role':role,'manifestSHA256':pin,'roleManifestSHA256':manifest['files'][f'roles/{role}/role-manifest.json'],
            'node':records[role],'peers':[records[r] for r in ROLES if r!=role]}

def parse_handshakes(raw,peers,now):
    observed={}
    for line in raw.decode('ascii','strict').splitlines():
        fields=line.split();assert len(fields)==2 and fields[1].isdecimal()
        assert fields[0] not in observed
        observed[fields[0]]=int(fields[1])
    expected={p['wireGuardPublicKey'] for p in peers}
    assert len(expected)==3 and set(observed)==expected
    # Keep the original nonzero rule. Ages are diagnostic, never a new policy
    # threshold; ping below remains the normal live reachability callee.
    assert all(stamp>0 for stamp in observed.values())
    return {'peerCount':3,'nonzeroHandshakeCount':3,'agesSeconds':sorted(now-v for v in observed.values() if v<=now),
            'futureTimestampCount':sum(v>now for v in observed.values()),'recencyThresholdApplied':False}

def parse_route(raw,address):
    values=json.loads(raw,object_pairs_hook=unique_pairs)
    assert isinstance(values,list) and len(values)==1
    value=values[0];assert value.get('dev')=='ynxwg0'
    assert value.get('dst') in (address,address+'/32')
    return {'targetIPv4':address,'dev':'ynxwg0'}

def remote_run(expected):
    assert os.getuid()==os.geteuid()==0
    def run(argv,seconds=3):
        p=subprocess.run(argv,stdin=subprocess.DEVNULL,capture_output=True,timeout=seconds,
                         env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C','LC_ALL':'C','TZ':'UTC'})
        assert p.returncode==0 and len(p.stdout)<=65536 and len(p.stderr)<=8192
        return p.stdout
    for service in ('ynx-consensus-overlay.service','ynx-chaind.service'):
        run(['systemctl','is-active','--quiet',service])
    run(['ip','link','show','ynxwg0'])
    routes=[]
    for peer in expected['peers']:
        address=peer['overlayAddress']
        routes.append(parse_route(run(['ip','-j','route','get',address]),address))
        # Preserve the existing two probes / two-second wait, not a timestamp
        # substitute or a different destination selected by the live interface.
        run(['ping','-c','2','-W','2',address],6)
    handshakes=parse_handshakes(run(['wg','show','ynxwg0','latest-handshakes']),expected['peers'],int(time.time()))
    print(json.dumps({'version':'YNX-CONSENSUS-OVERLAY-PUBLIC-VERIFY/v1','role':expected['role'],
                      'manifestSHA256':expected['manifestSHA256'],'roleManifestSHA256':expected['roleManifestSHA256'],
                      'exactIndependentPeerSet':True,'routes':routes,'normalPingPeerCount':3,
                      'handshakes':handshakes,'privateConfigRead':False,'peerKeysPrinted':False,
                      'authorityGranted':False,'nodeOrSignerReady':False},sort_keys=True,separators=(',',':')))

def emit_remote(expected):
    prefix='import json,os,subprocess,time\n'
    for function in (unique_pairs,parse_handshakes,parse_route,remote_run):prefix+=inspect.getsource(function)+'\n'
    return prefix+'EXPECTED='+repr(expected)+'''\ntry:remote_run(EXPECTED)
except Exception as exc:
    print(json.dumps({'status':'OVERLAY_VERIFY_REFUSED','errorType':type(exc).__name__,'privateConfigRead':False,'peerKeysPrinted':False}))
    raise SystemExit(1)
'''

def check_receipt(expected,raw):
    assert 0<len(raw)<=8192
    value=json.loads(raw,object_pairs_hook=unique_pairs)
    assert set(value)=={'version','role','manifestSHA256','roleManifestSHA256','exactIndependentPeerSet','routes','normalPingPeerCount','handshakes','privateConfigRead','peerKeysPrinted','authorityGranted','nodeOrSignerReady'}
    assert value['version']=='YNX-CONSENSUS-OVERLAY-PUBLIC-VERIFY/v1' and value['role']==expected['role']
    assert value['manifestSHA256']==expected['manifestSHA256'] and value['roleManifestSHA256']==expected['roleManifestSHA256']
    assert value['exactIndependentPeerSet'] is True and value['normalPingPeerCount']==3
    assert value['routes']==[{'targetIPv4':p['overlayAddress'],'dev':'ynxwg0'} for p in expected['peers']]
    assert value['handshakes']['peerCount']==value['handshakes']['nonzeroHandshakeCount']==3
    assert set(value['handshakes'])=={'peerCount','nonzeroHandshakeCount','agesSeconds','futureTimestampCount','recencyThresholdApplied'}
    assert isinstance(value['handshakes']['agesSeconds'],list) and all(type(n) is int and n>=0 for n in value['handshakes']['agesSeconds'])
    assert type(value['handshakes']['futureTimestampCount']) is int and 0<=value['handshakes']['futureTimestampCount']<=3
    assert len(value['handshakes']['agesSeconds'])+value['handshakes']['futureTimestampCount']==3
    assert value['handshakes']['recencyThresholdApplied'] is False
    assert all(value[k] is False for k in ('privateConfigRead','peerKeysPrinted','authorityGranted','nodeOrSignerReady'))
    return value

def main():
    assert len(sys.argv)==5 and sys.argv[1] in ('emit','check')
    expected=load_expectations(sys.argv[2],sys.argv[3],sys.argv[4])
    if sys.argv[1]=='emit':print(emit_remote(expected),end='')
    else:
        value=check_receipt(expected,sys.stdin.buffer.read(8193))
        print(json.dumps(value,sort_keys=True,separators=(',',':')))

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('overlay public input or receipt refused: '+type(exc).__name__,file=sys.stderr)
        sys.exit(1)
