#!/usr/bin/env python3
"""New transport DATA controls only; no process, socket, URL request or old suites."""
import argparse
import hashlib
import json
from pathlib import Path
from reviewed_transport_contract import reviewed_document, parse_line, require_https, meek_review, require_arti_rsa, Rejected


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('public_config', type=Path); p.add_argument('output', type=Path); a = p.parse_args()
    out = a.output.resolve(); out.mkdir(mode=0o700, parents=True, exist_ok=False)
    raw = a.public_config.read_bytes(); parsed = meek_review(raw); accepted = []
    def reject(name, fn):
        try: fn()
        except Rejected as e: accepted.append({'name': name, 'reason': str(e)})
        else: raise AssertionError(name+' did not reject')
    reject('original-reviewed-meek-missing-rsa', lambda: require_arti_rsa(parsed))
    reject('source-byte-change', lambda: reviewed_document(raw+b' '))
    reject('source-oversize', lambda: reviewed_document(b'x'*65537))
    synthetic = 'snowflake 192.0.2.3:80 '+'A'*40+' url=https://example.invalid/'
    assert require_arti_rsa(parse_line(synthetic))['protocol'] == 'snowflake'
    for name, line in [
        ('newline', synthetic+'\nSECRET'), ('port-implicit', 'snowflake 192.0.2.3 '+'A'*40+' url=https://example.invalid/'),
        ('hostname-as-bridge', 'snowflake example.invalid:80 '+'A'*40+' url=https://example.invalid/'),
        ('port-zero', synthetic.replace(':80 ', ':0 ')), ('duplicate-option', synthetic+' url=https://other.invalid/'),
        ('unknown-transport', synthetic.replace('snowflake ', 'madeup ', 1)), ('oversize', synthetic+'x'*4096)]:
        reject(name, lambda line=line: parse_line(line))
    for name, url in [('http-url','http://example.invalid/'),('userinfo','https://user:secret@example.invalid/'),('fragment','https://example.invalid/#token'),('nondefault-port','https://example.invalid:9443/'),('encoded-host','https://example%2einvalid/')]:
        reject(name, lambda url=url: require_https(url))
    result = {'schema':'P05_REVIEWED_TRANSPORT_DATA_DELTA_V1','status':'PASS','rejections':accepted,'newChecks':len(accepted)+1,'acceptedOnlySyntheticGrammarNotAuthority':True,'sourceSHA256':hashlib.sha256(raw).hexdigest(),'sourceAndTestPins':{str(x):hashlib.sha256(x.read_bytes()).hexdigest()for x in[Path(__file__),Path(__file__).with_name('reviewed_transport_contract.py')]},'observedOriginalMeekHasRSA':parsed['fingerprint']is not None,'vendorOrNetworkStarted':False}
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'PASS','newChecks':result['newChecks'],'originalMeekRSA':'NOT_SUPPLIED','network':'NOT_RUN'}))


if __name__ == '__main__': main()
