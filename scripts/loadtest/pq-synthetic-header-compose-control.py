"""Actual original source-only composer, called once under the original Window."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

spec=importlib.util.spec_from_file_location('header_original_live_source_reader',Path(__file__).with_name('pq-normal-live-reader.py'))
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
SOURCES={
    'edf5b12deb65f94e6e731708f336ca1af23bcfe1':('a2348dc67ee627fcfc3021c513315acd7b9abc7b','aadf0831c6b65559065ca82228bab30811d36c67'),
    'bbe860e8744a479e1838db9b7ae26b8d9a8bb34e':('7f70fd791e1706ad151b2e3d6e68a16c586650aa','5a128880d14bfc73de4334cba23218859ad3473c'),
}

def source_identity(source):
    if not source.is_absolute() or source.resolve(strict=True)!=source or source.is_symlink():
        raise RuntimeError('canonical original composition source required')
    def git(ref):
        return subprocess.check_output(['git','-C',str(source),'rev-parse',ref],timeout=5,
            env=dict(os.environ,GIT_NO_LAZY_FETCH='1')).decode().strip()
    return git('HEAD'),git('HEAD^{tree}'),git('HEAD:third_party/cometbft')

def main():
    if len(sys.argv)!=4:raise RuntimeError('exact original source and private destination required')
    source,destination,commit=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
    if commit not in SOURCES or source_identity(source)!=(commit,*SOURCES[commit]):
        raise RuntimeError('exact original composition source/tree/fork differs before output')
    result=reader.prepare_matching_source(source,destination,held_source_only=True)
    if (result['source']['commit']!=commit or result.get('sourceCompositionOnly') is not True
            or any(result.get(key) is not False for key in ('runtimeAuthorized','sourceCIQualified','pressureAuthorized','carrierEnabled','actualNetworkWindow'))):
        raise RuntimeError('original source-only composition identity or scope differs')
    selection=destination/'SOURCE-SELECTION.json';native=destination/'SOURCE-NATIVE-DEPENDENCIES.json'
    selection_raw=selection.read_bytes();native_raw=native.read_bytes()
    if not (0<len(selection_raw)<=65536 and 0<len(native_raw)<=65536):raise RuntimeError('original source receipts exceed bound')
    data=dict(version='YNX-SYNTHETIC-HEADER-COMPOSE-CONTROL/v1',source=commit,sourceTree=result['source']['tree'],
        forkTree=result['source']['forkTree'],supplierCommit=result['optionalForkCommit'],supplierTree=result['optionalForkTree'],
        selectionBytes=len(selection_raw),selectionSHA256=hashlib.sha256(selection_raw).hexdigest(),
        nativeBytes=len(native_raw),nativeSHA256=hashlib.sha256(native_raw).hexdigest(),
        sourceCompositionOnly=True,sourceCIQualified=False,runtimeAuthorized=False,pressureAuthorized=False,actualNetworkWindow=False)
    path=destination.parent/'composition-control.json'
    with path.open('x',encoding='utf8') as output:json.dump(data,output,sort_keys=True,separators=(',',':'));output.write('\n')

if __name__=='__main__':main()
