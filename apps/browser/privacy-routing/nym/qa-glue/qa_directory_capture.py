"""DATA decoder for a same-owned-child QA directory capture, never an authority.

The caller must separately prove original Popen wait(0), actual pipe EOF on both
streams, exact binary/source/plan pins and the once-issued wall+monotonic deadline.
There is deliberately no disk-import, Root, route-ready or normal-admission API.
"""
from dataclasses import dataclass
import hashlib
import json
import re

PREFIX=b'YNX_NYM_QA_DIRECTORY_CANDIDATES_V1 '
class CaptureError(ValueError): pass

def _unique_object(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise CaptureError('duplicate-json-key')
        value[key]=item
    return value

def _json(data):
    try:return json.loads(data.decode('utf-8','strict'),object_pairs_hook=_unique_object)
    except (UnicodeError,json.JSONDecodeError) as error:raise CaptureError('capture-json') from error

def _ids(value):
    if not isinstance(value,list) or not value or len(value)>20000 or any(type(x) is not int or not 0<=x<=4294967295 for x in value):
        raise CaptureError('candidate-id-type-or-count')
    if value!=sorted(set(value)):raise CaptureError('candidate-id-order-or-duplicate')
    return tuple(value)

def _rows(table):
    if not isinstance(table,dict) or not isinstance(table.get('data'),list):raise CaptureError('directory-table-type')
    rows=table['data'];size=len(rows)
    if not 0<size<=20000 or table.get('pagination')!={'total':size,'size':size,'page':0}:raise CaptureError('directory-table-incomplete')
    mapped={}
    for row in rows:
        if not isinstance(row,dict) or type(row.get('node_id')) is not int or not 0<=row['node_id']<=4294967295 or row['node_id'] in mapped:raise CaptureError('directory-node-id')
        mapped[row['node_id']]=row
    return mapped

@dataclass(frozen=True)
class ParsedDirectoryData:
    # All fields are evidence DATA. This type cannot start a process or authorize a URL.
    value: dict
    payload_sha256: str
    entry_node_ids: tuple
    exit_node_ids: tuple

def parse_directory_output(stdout,stderr,expected_run_id):
    if not isinstance(stdout,bytes) or not 0<len(stdout)<=16777217 or not stdout.endswith(b'\n'):
        raise CaptureError('directory-payload-bound-or-terminator')
    if not isinstance(stderr,bytes) or len(stderr)>524288 or not re.fullmatch(r'qa-dir-[0-9a-f]{32}',expected_run_id):
        raise CaptureError('directory-stderr-or-nonce')
    # Only complete LF-terminated control lines qualify; no ANSI stripping or search
    # through a log message, and no JSON re-encoding before hashing the payload.
    markers=[line[len(PREFIX):] for line in stderr.split(b'\n')[:-1] if line.startswith(PREFIX)]
    if len(markers)!=1 or len(markers[0])>262144:raise CaptureError('candidate-frame-count-or-bound')
    frame=_json(markers[0])
    if not isinstance(frame,dict) or set(frame)!={'schema','runID','payloadSHA256','entryNodeIDs','exitNodeIDs'} or frame['schema']!='YNX_NYM_QA_DIRECTORY_CANDIDATES_V1' or frame['runID']!=expected_run_id:
        raise CaptureError('candidate-frame-scope')
    raw=stdout[:-1];digest=hashlib.sha256(raw).hexdigest()
    if frame['payloadSHA256']!=digest:raise CaptureError('candidate-payload-sha256')
    entries=_ids(frame['entryNodeIDs']);exits=_ids(frame['exitNodeIDs'])
    if len(entries)+len(exits)>20000 or set(entries)&set(exits):raise CaptureError('candidate-pools-overlap-or-count')
    value=_json(raw)
    if not isinstance(value,dict) or set(value)!={'schema','basic','described','epoch'} or value['schema']!='YNX_NYM_DIRECTORY_V1':raise CaptureError('directory-envelope')
    basics=_rows(value['basic']['nodes']);described=_rows(value['described'])
    for node_id,role,flag in [(x,'EntryGateway','entry') for x in entries]+[(x,'ExitGateway','exit_nr') for x in exits]:
        node=basics.get(node_id);detail=described.get(node_id)
        if node is None or detail is None or node.get('role')!=role or node.get('supported_roles',{}).get(flag) is not True:raise CaptureError('candidate-role-or-join')
        host=detail['description']['host_information']
        if not node.get('ip_addresses') or set(node['ip_addresses'])!=set(host['ip_address']) or node.get('ed25519_identity_pubkey')!=host['keys']['ed25519']:raise CaptureError('candidate-identity-or-ip-join')
        if role=='EntryGateway':
            entry=node.get('entry');websockets=detail['description']['mixnet_websockets']
            if not isinstance(entry,dict) or not isinstance(entry.get('hostname'),str) or entry['hostname']!=host.get('hostname') or type(entry.get('wss_port')) is not int or not 0<entry['wss_port']<=65535 or entry['wss_port']!=websockets.get('wss_port') or entry.get('ws_port')!=websockets.get('ws_port'):
                raise CaptureError('candidate-tls-fields')
        else:
            requester=detail['description'].get('network_requester')
            if not isinstance(requester,dict) or requester.get('uses_exit_policy') is not True or not isinstance(requester.get('address'),str) or requester['address'].rsplit('@',1)[-1]!=node['ed25519_identity_pubkey']:
                raise CaptureError('candidate-requester-fields')
            # No Python crypto or regex is claimed as a Recipient codec. Membership
            # in this exact-byte source frame is the actual Rust typed-codec result.
    return ParsedDirectoryData(value,digest,entries,exits)

def require_terminal_capture(waited_exit,stdout_eof,stderr_eof,overflow,capture_inhibited,expires_at,deadline_monotonic_ns,now_wall,now_monotonic_ns):
    """Reject-only observation checks. Caller supplies actual own-handle observations.

    Returning None is not a permit: parsed DATA still needs the original child,
    source pins and caller-owned operation. These parameters are not normal gates.
    """
    if type(waited_exit) is not int or waited_exit!=0 or stdout_eof is not True or stderr_eof is not True or overflow is not False or capture_inhibited is not False:
        raise CaptureError('original-child-or-pipe-not-complete')
    if now_wall>=expires_at or now_monotonic_ns>=deadline_monotonic_ns:raise CaptureError('capture-expired-not-restampable')
