import pathlib,json,subprocess,re,hashlib
root=pathlib.Path.cwd();path='apps/creator-studio/ios/YNXCreator/catalog.json';b=(root/path).read_bytes();j=json.loads(b);before=json.loads(subprocess.check_output(['git','show','ecfa4a56fca5804bc45aeb4762023ef03719ae95:'+path]));keys=set(j['en']);added=0
for lang,values in j.items():
 assert set(values)==keys,(lang,'missing keys')
 assert all(isinstance(s,str) and s.strip() and '\ufffd' not in s and not any(ord(c)<32 for c in s) for s in values.values()),lang
 assert all(values[k]==v for k,v in before[lang].items()),(lang,'inherited translation changed')
 added+=len(set(values)-set(before[lang]))
 for unit in ['5 MiB','1 MiB']:
  assert unit in values['assetHelp'],(lang,unit)
 assert re.search(r'100\s*%',values['rightsSharesHelp']),(lang,'100 percent requirement')
 assert 'YNX' in values['rightsContributorAccount'] and 'SHA-256' in values['rightsSourceHash'],lang
assert added==880
ui=(root/'apps/creator-studio/ios/YNXCreator/YNXCreatorApp.swift').read_text();literal=set(re.findall(r'model.text\("([^"\n]+)"\)',ui));assert literal<=keys,literal-keys
assert '.environment(\\.locale,Locale(identifier:model.locale))' in ui
assert '.environment(\\.layoutDirection,model.locale=="ar" ? .rightToLeft : .leftToRight)' in ui
report={'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'catalogPath':path,'catalogBytes':len(b),'catalogSHA256':hashlib.sha256(b).hexdigest(),'locales':list(j),'keysPerLocale':len(keys),'addedTranslations':added,'everyLocaleKeyComplete':True,'inheritedTranslationsPreserved':True,'UTF8AndNonemptyValues':True,'assetSizeAndShareLimitsPreserved':True,'literalUIKeysCovered':len(literal),'chosenLocaleAndArabicLayoutSource':True,'installedLayoutAcceptance':False,'independentNativeSpeakerReview':False}
pathlib.Path('/tmp/ynx-creator-expiry-locales-coverage-20261004.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
