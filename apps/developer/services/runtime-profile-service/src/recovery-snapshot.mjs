// Fixed, read-only remote program. Directory/file descriptors avoid following
// user-created links while a remote workspace may still be changing.
export const RECOVERY_SNAPSHOT_PYTHON = String.raw`import os,sys,json,stat
MAX_BYTES=2*1024*1024
files={}; folders=[]; omitted={'binary':0,'links':0,'unsupported':0}; total=0; read_bytes=0; visited=0
def valid(path):
 return len(path)<=1024 and all(p not in ('','.','..') for p in path.split('/')) and not any(ord(c)<32 or c=='\\' for c in path)
def walk(fd,prefix='',depth=0):
 global total,read_bytes,visited
 if depth>16: raise ValueError('depth')
 names=[]
 with os.scandir(fd) as entries:
  for entry in entries:
   if len(names)>=512: raise ValueError('entries')
   names.append(entry.name)
 for name in sorted(names):
  visited+=1
  if visited>2048: raise ValueError('entries')
  path=prefix+'/'+name if prefix else name
  if name in ('.tmp','.ynx-build'): continue
  if not valid(path): omitted['unsupported']+=1; continue
  info=os.stat(name,dir_fd=fd,follow_symlinks=False)
  if stat.S_ISLNK(info.st_mode): omitted['links']+=1; continue
  if stat.S_ISDIR(info.st_mode):
   if len(folders)>=256: raise ValueError('directories')
   sub=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
   try: folders.append(path); walk(sub,path,depth+1)
   finally: os.close(sub)
  elif stat.S_ISREG(info.st_mode):
   if len(files)>=256 or info.st_size>MAX_BYTES-total: raise ValueError('size')
   source=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
   try:
    current=os.fstat(source)
    if not stat.S_ISREG(current.st_mode): raise ValueError('type')
    chunks=[]; used=0
    while True:
     chunk=os.read(source,min(65536,MAX_BYTES-total-used+1))
     if not chunk: break
     used+=len(chunk)
     read_bytes+=len(chunk)
     if read_bytes>8*1024*1024: raise ValueError('read budget')
     if total+used>MAX_BYTES: raise ValueError('size')
     chunks.append(chunk)
    raw=b''.join(chunks)
   finally: os.close(source)
   try:
    if b'\0' in raw: raise UnicodeError()
    text=raw.decode('utf-8')
   except UnicodeError: omitted['binary']+=1; continue
   total+=len(raw); files[path]=text
  else: omitted['unsupported']+=1
try:
 path=sys.argv[1]
 parts=path.split('/')[1:] if path.startswith('/') else path.split('/')
 if not parts or any(p in ('','.','..') or '\\' in p for p in parts): raise ValueError('root')
 root=os.open('/' if path.startswith('/') else '.',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  for part in parts:
   child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=root)
   os.close(root); root=child
  walk(root)
 finally: os.close(root)
 print(json.dumps({'files':files,'folders':folders,'omitted':omitted},ensure_ascii=True,separators=(',',':')))
except Exception:
 sys.stderr.write('Recovery copy could not be read within its boundary.\n'); sys.exit(3)
`;

export function validateRecoverySnapshot(value) {
  const valid = path => typeof path === "string" && path.length <= 1024 && !/[\\\x00-\x1f]/.test(path) && path.split("/").every(part => part && part !== "." && part !== "..");
  if (!value || typeof value !== "object" || !value.files || typeof value.files !== "object" || Array.isArray(value.files) || !Array.isArray(value.folders)) throw new Error("Invalid recovery snapshot");
  const entries = Object.entries(value.files), files = Object.create(null), folders = [...new Set(value.folders)]; let bytes = 0;
  if (entries.length > 256 || folders.length > 256 || !folders.every(valid)) throw new Error("Recovery boundary exceeded");
  for (const [path, content] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!valid(path) || typeof content !== "string" || content.includes("\0")) throw new Error("Invalid recovery file");
    bytes += Buffer.byteLength(content); if (bytes > 2 * 1024 * 1024) throw new Error("Recovery boundary exceeded");
    files[path] = content;
  }
  const omitted = Object.fromEntries(["binary", "links", "unsupported"].map(kind => [kind, Number.isSafeInteger(value.omitted?.[kind]) && value.omitted[kind] >= 0 ? value.omitted[kind] : 0]));
  return { files, folders: folders.sort(), omitted, bytes, fileCount: entries.length };
}
