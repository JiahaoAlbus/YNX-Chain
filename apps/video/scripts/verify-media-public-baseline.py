#!/usr/bin/env python3
# Read recorded HTTP bytes/hashes and exact Git objects; no deployment or keys.
import json,pathlib,subprocess,hashlib
out=pathlib.Path(__file__).resolve().parents[1]/'audit/evidence/video-creator-sdk-adoption-20261003'
root=pathlib.Path(__file__).resolve().parents[3]
data=json.loads((out/'public-no-regression-baseline.json').read_text());sources=[]
def git(*args):return subprocess.check_output(['git','-C',str(root),*args])
for row in data['rows']:
 manifest=row.get('manifest')
 if not manifest:continue
 source=manifest['sourceCommit'];product='video' if 'video.ynx' in row['url'] else 'creator-studio';tree=git('rev-parse',source+'^{tree}').decode().strip();ancestor=subprocess.run(['git','-C',str(root),'merge-base','--is-ancestor',source,'HEAD']).returncode==0
 files=manifest['files'];pins=files if isinstance(files,list) else [{'path':k,**v} for k,v in files.items()];checked=[]
 for asset in data['rows']:
  origin=row['url'].rsplit('/',1)[0]
  if not asset['url'].startswith(origin+'/') or asset['status']!=200:continue
  path=asset['url'].split(origin+'/',1)[1];pin=next((p for p in pins if p['path']==path),None)
  if pin:checked.append({'path':path,'publicEqualsDeclaredHash':asset['sha256']==pin['sha256'],'publicEqualsDeclaredBytes':asset['bytes']==pin['bytes'],'publicEqualsExactGitSource':hashlib.sha256(git('show',source+':apps/'+product+'/'+path)).hexdigest()==asset['sha256']})
 sources.append({'product':product,'frontendDeclaredSourceCommit':source,'frontendDeclaredSourceTree':tree,'inheritedAncestor':ancestor,'sampledActualPublicGitPins':checked})
unchanged=[]
for product in ['video','creator-studio']:
 for name in ['app.js','index.html','styles.css']:
  path='apps/'+product+'/'+name;b=git('show','b14aabbabbb7af9c3d13abadd03808782d5fccd3:'+path);unchanged.append({'path':path,'unchangedFromInheritedFreeze':b==(root/path).read_bytes()})
result={'schema':'ynx.media.no-regression-baseline.v1','sources':sources,'unchangedNormalProductUI':unchanged,'publicBackendSourceCommit':'48fe3824cc6a38ba944427776e48d076f27f54f5','publicBackendSourceTree':git('rev-parse','48fe3824cc6a38ba944427776e48d076f27f54f5^{tree}').decode().strip(),'officialSDK529BytesPreserved':all(r.get('equalsPreservedSDK529Bytes') is True for r in data['rows'] if r['url'].endswith('/product-session-sdk.js')),'actualInstalledAppBaselineVerified':False,'actualWalletApproval':False,'note':'Do not infer public source from a version label alone. Keep sampled hash and Git mismatches explicit; preserve actual SDK529 bytes and inherited normal UI. Final Host/API/frontend/install About version and branding must align before public acceptance.'}
result['sampledPublicSourcePinsMatch']=all(all(x['publicEqualsExactGitSource'] and x['publicEqualsDeclaredHash'] and x['publicEqualsDeclaredBytes'] for x in s['sampledActualPublicGitPins']) for s in sources)
(out/'no-regression-baseline-receipt.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'sources':sources,'unchangedNormalProductUI':unchanged,'sampledPublicSourcePinsMatch':result['sampledPublicSourcePinsMatch']},indent=2))
assert all(x['unchangedFromInheritedFreeze'] for x in unchanged) and result['officialSDK529BytesPreserved']
