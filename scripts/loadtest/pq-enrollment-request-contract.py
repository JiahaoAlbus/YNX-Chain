"""Shape-only fixed original request decoder, shared by custody-free accounting.

No caller permission, signature, record MAC or current eligibility is verified.
"""
import base64
import hashlib
import json
import re

SOURCE='0a3a44f80159df800eeec8b54d200d982c5af762'
# These source objects share the exact inspected original request/producer
# blob. This permits BYTE DECODING only; no source CI, binary or runtime grant
# is inherited. Preserve the actual source in every reservation and outer join.
INSPECTED_PRODUCER_ABIS={SOURCE:'260ce946f8c76b63c15ff08a6d389138a74a8b52',
    '2b5eaa56f82c1e06f4ff959048ec8344f5effff3':'260ce946f8c76b63c15ff08a6d389138a74a8b52'}
SCHEMA='YNX-PQ-DURABLE-ENROLLMENT-PAIR/v1'
NORMAL_DUAL_CONFIRMATION_CALLEE=None

def require(value,message):
    if not value:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def digest(value):return type(value) is str and re.fullmatch('[0-9a-f]{64}',value) is not None
def inspected_source(value):return type(value) is str and value in INSPECTED_PRODUCER_ABIS
def strict(raw,limit):
    require(type(raw) is bytes and 0<len(raw)<=limit,'bounded original enrollment JSON required')
    def pairs(items):
        value={}
        for key,item in items:
            require(key not in value,'duplicate original enrollment field');value[key]=item
        return value
    def constant(value):raise ValueError('non-finite original enrollment field')
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=constant)
def number(value):
    require(type(value) is str and re.fullmatch('[1-9][0-9]*',value) is not None and len(value)<=20,
            'canonical original enrollment number required')
    n=int(value);require(n<1<<64,'bounded original enrollment number required');return n
def b64(value,size):
    require(type(value) is str and len(value)<=4*((size+2)//3),'bounded original public bytes required')
    raw=base64.b64decode(value,validate=True)
    require(len(raw)<=size and base64.b64encode(raw).decode()==value,'canonical original public bytes required');return raw
def request(raw):
    r=strict(raw,16<<10)
    fields=('version','fundingOperationId','migrationOperationId','ownerIndex','fundingNonce','targetOwner',
            'fundingAmount','activationHeight','pka','pkb')
    require(type(r) is dict and set(r)==set(fields),'closed original pair request required')
    require(r['version']=='YNX-PQ-LAB-ENROLLMENT-REQUEST/v1' and digest(r['fundingOperationId'])
            and digest(r['migrationOperationId']) and r['fundingOperationId']!=r['migrationOperationId']
            and type(r['ownerIndex']) is int and 0<=r['ownerIndex']<1000,'distinct original pair operations and sponsor required')
    require(number(r['fundingNonce'])>=2 and 3<=number(r['fundingAmount'])<(1<<63)-1
            and number(r['activationHeight'])<1<<63 and type(r['targetOwner']) is str and 0<len(r['targetOwner'])<=128
            and len(b64(r['pka'],2592))==2592 and len(b64(r['pkb'],64))==64,'bounded original pair request fields required')
    # Exact fixed Go struct order/encoding used by request.json and the normal
    # CLI's json.Marshal(Request) digest; this is not a new wire encoding.
    canonical=json.dumps({key:r[key] for key in fields},ensure_ascii=False,separators=(',',':'),allow_nan=False)
    for char,escaped in (('<','\\u003c'),('>','\\u003e'),('&','\\u0026'),('\u2028','\\u2028'),('\u2029','\\u2029')):
        canonical=canonical.replace(char,escaped)
    require(raw==canonical.encode('utf-8'),'original canonical request bytes differ')
    return r
