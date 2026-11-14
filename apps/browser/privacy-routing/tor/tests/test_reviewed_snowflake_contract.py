#!/usr/bin/env python3
"""New fixed Snowflake DATA contract only. Does not start Lyrebird or ICE/STUN."""
import argparse
import hashlib
import json
from pathlib import Path
from reviewed_transport_contract import snowflake_review, reviewed_document, Rejected


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('public_config', type=Path); p.add_argument('output', type=Path); a = p.parse_args()
    out = a.output.resolve(); out.mkdir(mode=0o700, parents=True, exist_ok=False)
    raw = a.public_config.read_bytes(); parsed = snowflake_review(raw)
    assert len(parsed) == 2 and all(v['encodedSettingsBytes'] == 387 for v in parsed)
    assert all(v['fingerprint'] == v['options']['fingerprint'] for v in parsed)
    # Any modification, including alternate origin/peer/STUN, must lose the exact source pin.
    document = reviewed_document(raw); rejections = []
    for name, transform in [
        ('changed-broker', lambda s: s.replace('url=https://', 'url=http://', 1)),
        ('changed-ice-scope', lambda s: s.replace('ice=stun:', 'ice=turn:', 1)),
        ('missing-rsa', lambda s: ' '.join(s.split()[:2]+s.split()[3:])),
        ('append-override', lambda s: s+' proxy=socks5://127.0.0.1:1')]:
        changed = json.loads(json.dumps(document)); changed['bridges']['snowflake'][0] = transform(changed['bridges']['snowflake'][0])
        try: snowflake_review(json.dumps(changed).encode())
        except Rejected as e: rejections.append({'case':name,'reason':str(e)})
        else: raise AssertionError(name+' was accepted')
    result = {'schema':'P05_FIXED_SNOWFLAKE_SCOPE_DATA_V1','status':'PASS','newChecks':6,'twoReviewedLinesRSAAndProtocol':True,'exactArtiSettingsEncodedBytes':[v['encodedSettingsBytes']for v in parsed],'rejections':rejections,'sourceAndTestPins':{str(p):hashlib.sha256(p.read_bytes()).hexdigest()for p in[Path(__file__),Path(__file__).with_name('reviewed_transport_contract.py')]},'rawEndpointOrURLPersisted':False,'LyrebirdICESocketsSTUNOrBrowser':'NOT_RUN','scopeIsAuthority':False}
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'PASS','newChecks':6,'runtime':'NOT_RUN'}))


if __name__=='__main__': main()
