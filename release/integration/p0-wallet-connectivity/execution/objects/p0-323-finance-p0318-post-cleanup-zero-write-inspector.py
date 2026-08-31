#!/usr/bin/env python3
import hashlib
import json
import os
import stat
import subprocess
import sys
import urllib.error
import urllib.request

PARENT = "/opt/ynx/leases/finance"
TARGETS = [
    "finance-combined-4f7fba323a89-20260831t041500z.executor.sh",
    "finance-combined-4f7fba323a89-20260831t041500z.json",
]
QUARANTINES = [
    ".p0322-finance-p0318-retained-control-cleanup-20260831t063800z.executor.owned",
    ".p0322-finance-p0318-retained-control-cleanup-20260831t063800z.signedLease.owned",
]
EXPECTED_SIBLINGS = [
    {"name":"p0300-finance-phase3-20260824t210000z.executor.sh","tuple":"64770:4620810:0:0:700:1:20058:regular file","sha256":"fe124f17ead7120a7737efc104ce2f9ce6d14340f8be595bd85f9ffde1350682"},
    {"name":"p0300-finance-phase3-20260824t210000z.json","tuple":"64770:4620811:0:0:600:1:10685:regular file","sha256":"8433c91ac315743cd577c549231cc683b2a38b5a6e9918bb2d8123d6158c8506"},
    {"name":"p0302-finance-phase3-20260823t211500z.executor.sh","tuple":"64770:4620861:0:0:700:1:25790:regular file","sha256":"a42d4a85c8ba98d55ea890e5978ccc14acd2a4aacb7931ebcbfc51daafdffe8c"},
    {"name":"p0302-finance-phase3-20260823t211500z.json","tuple":"64770:4620862:0:0:600:1:11072:regular file","sha256":"512f129861c6ae5db100f467c4ed52ef3785b32fa3309daae21a21250a4322b0"},
]

def kind(mode):
    if stat.S_ISREG(mode): return "regular file"
    if stat.S_ISDIR(mode): return "directory"
    if stat.S_ISLNK(mode): return "symbolic link"
    return "other"

def full_tuple(value):
    return f"{value.st_dev}:{value.st_ino}:{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode):o}:{value.st_nlink}:{value.st_size}:{kind(value.st_mode)}"

def stable(value):
    return f"{value.st_dev}:{value.st_ino}:{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode):o}:directory"

def sha_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk: break
            digest.update(chunk)
    return digest.hexdigest()

def fact(path):
    try: value = os.lstat(path)
    except FileNotFoundError: return {"path":path,"classification":"absent"}
    result = {"path":path,"classification":kind(value.st_mode),"tuple":full_tuple(value)}
    if stat.S_ISREG(value.st_mode): result["sha256"] = sha_file(path)
    if stat.S_ISLNK(value.st_mode): result["target"] = os.readlink(path)
    return result

def inventory(path):
    value = os.lstat(path)
    children = []
    for name in sorted(os.listdir(path)):
        child = os.path.join(path, name)
        child_value = os.lstat(child)
        children.append({"name":name,"tuple":full_tuple(child_value),"sha256":sha_file(child) if stat.S_ISREG(child_value.st_mode) else None})
    encoded = json.dumps(children, separators=(",", ":"), sort_keys=True).encode()
    return {"fullTuple":full_tuple(value),"stableIdentity":stable(value),"directChildren":len(children),"inventorySha256":hashlib.sha256(encoded).hexdigest(),"children":children}

def http(url):
    request = urllib.request.Request(url, headers={"User-Agent":"central-p0323-zero-write/1"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read(); status = response.status; content_type = response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as response:
        body = response.read(); status = response.code; content_type = response.headers.get("Content-Type", "")
    return {"url":url,"status":status,"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),"contentType":content_type}

def require(condition, label):
    if not condition: raise RuntimeError(label)

def main():
    parent = inventory(PARENT)
    require(parent["stableIdentity"] == "64770:4594822:0:0:750:directory", "PARENT_IDENTITY")
    require(parent["directChildren"] == 4, "PARENT_CHILD_COUNT")
    require(parent["inventorySha256"] == "deb186c19791039c1074c279f667004250e78992fea703bcd513abff58604607", "PARENT_INVENTORY")
    require(parent["children"] == EXPECTED_SIBLINGS, "PRESERVED_SIBLINGS")
    absence = {name:fact(os.path.join(PARENT, name)) for name in TARGETS + QUARANTINES}
    require(all(item["classification"] == "absent" for item in absence.values()), "TARGET_OR_QUARANTINE_PRESENT")
    carrier = inventory("/opt/ynx/stage/finance/finance-combined-4f7fba323a89-20260831t041500z")
    require(carrier["fullTuple"] == "64770:4594824:0:0:700:2:4096:directory", "CARRIER_TUPLE")
    require(carrier["directChildren"] == 2 and carrier["inventorySha256"] == "7da2fd25158089f0659a7d837b261ab0288c20f2ddcefdc4e91878135cb0ff73", "CARRIER_INVENTORY")
    runtime = {
        "current":fact("/opt/ynx/finance-current"),
        "currentResolved":os.path.realpath("/opt/ynx/finance-current"),
        "binary":fact("/opt/ynx/finance-current/ynx-finance"),
        "environment":fact("/etc/ynx/finance.env"),
        "unit":fact("/etc/systemd/system/ynx-finance.service"),
        "caddy":fact("/etc/caddy/conf.d/ynx-finance.caddy"),
        "state":fact("/var/lib/ynx/finance/state.json"),
    }
    require(runtime["current"]["tuple"] == "64770:1330149:0:0:777:1:50:symbolic link" and runtime["current"]["target"] == "/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a", "CURRENT")
    require(runtime["binary"]["tuple"] == "64770:1860512:0:0:755:1:8573112:regular file" and runtime["binary"]["sha256"] == "0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f", "BINARY")
    require(runtime["environment"]["sha256"] == "854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252", "ENVIRONMENT")
    require(runtime["unit"]["sha256"] == "2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b", "UNIT")
    require(runtime["caddy"]["sha256"] == "dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282", "CADDY")
    require(runtime["state"]["classification"] == "absent", "STATE")
    service = {key:subprocess.check_output(["/usr/bin/systemctl","show","ynx-finance.service","-p",key,"--value"], text=True).strip() for key in ["LoadState","ActiveState","SubState","MainPID","NRestarts","User","Group"]}
    require(service == {"LoadState":"loaded","ActiveState":"active","SubState":"running","MainPID":"2818779","NRestarts":"0","User":"ynx","Group":"ynx"}, "SERVICE")
    urls = [
        "http://127.0.0.1:6483/", "http://127.0.0.1:6483/health", "http://127.0.0.1:6483/version",
        "https://finance.ynxweb4.com/", "https://finance.ynxweb4.com/health", "https://finance.ynxweb4.com/version",
        "https://finance.ynxweb4.com/app.js", "https://finance.ynxweb4.com/read-sources.js", "https://finance.ynxweb4.com/styles.css",
        "https://finance.ynxweb4.com/manifest.webmanifest", "https://finance.ynxweb4.com/ynx-logo.png", "https://finance.ynxweb4.com/wallet-auth.js",
        "https://finance.ynxweb4.com/build-identity.json", "https://finance.ynxweb4.com/wallet-connect.js"
    ]
    responses = [http(url) for url in urls]
    expected = [
        (200,11427,"c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53"),(200,485,"d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1"),(200,130,"39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226"),
        (200,11427,"c1fc45eecd7f88de6fc3e049d15161b8d4e9878e31f20c977fc52b383a18ed53"),(200,485,"d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1"),(200,130,"39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226"),
        (200,17371,"a1ed94de08fc5b73f075cf35c1b17481e24b6046732ad92d82209959b694c6d6"),(200,10920,"e19b7b266c14b181a4d88b10c6e1975398bdafb77660272f37ba22b48fc18c70"),(200,13935,"bd01b920fee3693204a63aed364c27becf4c9c84f3ee1ed9dd3e2d35a39b5d9f"),
        (200,241,"3f7bec35f54aad6a095151e9d4d553e7ea10cbbbcc9e16f0f3fe7abd242b6d05"),(200,104171,"df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d"),(200,66997,"be5c90e938e5d5b6e181199f2e1e3949b8f343c4e1af4d8aceab27b1ed41bf6d"),
        (404,19,"b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793"),(404,19,"b16e15764b8bc06c5c3f9f19bc8b99fa48e7894aa5a6ccdad65da49bbf564793")
    ]
    require([(x["status"],x["bytes"],x["sha256"]) for x in responses] == expected, "HTTP")
    print(json.dumps({"inspection":"FINANCE_P0318_POST_CLEANUP_ZERO_WRITE","absence":absence,"parent":parent,"carrier":carrier,"runtime":runtime,"service":service,"http":responses,"verificationComplete":True,"cleanupComplete":True,"mutationCount":0}, separators=(",", ":"), sort_keys=True))

if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(f"p0323-zero-write-fail:{type(error).__name__}:{error}", file=sys.stderr)
        raise SystemExit(65)
