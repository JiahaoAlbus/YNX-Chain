#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path

root=Path(__file__).resolve().parent

def load(name, filename):
    spec=importlib.util.spec_from_file_location(name,root/filename)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

history=load('history','pq-history-events-ci.py')
finalize=load('finalize','qualify-pq-finalize-ci.py')

class OriginalEvents(unittest.TestCase):
    def test_all_history_cases_and_rejections(self):
        for (slug, index),(positive,names) in history.CASES.items():
            package='github.com/JiahaoAlbus/YNX-Chain/'+('cmd/ynx-consensus-key-init' if slug=='ceremony' and index==3 else 'cmd/ynx-comet' if slug=='comet-layout' else 'internal/consensus')
            raw=''.join('=== RUN   '+name+'\n'+''.join('=== RUN   '+c+'\n' for c in history.REQUIRED_CHILDREN.get((slug,index),()) if c.startswith(name+'/'))+'--- '+('PASS' if positive else 'FAIL')+': '+name+' (0.00s)\n'+''.join('    --- '+history.EXPECTED_RED_CHILDREN.get((slug,index),{}).get(c, 'pass' if positive else 'fail').upper()+': '+c+' (0.00s)\n' for c in history.REQUIRED_CHILDREN.get((slug,index),()) if c.startswith(name+'/')) for name in names)+('ok' if positive else 'FAIL')+'\t'+package+'\t0.1s\n'+('' if positive else 'FAIL\n')
            status=0 if positive else 1
            with self.subTest(slug=slug,index=index):
                history.qualify(raw,slug,index,status)
                for bad in (raw.replace('=== RUN', '=== OMIT',1),raw.replace('--- PASS:', '--- SKIP:',1) if positive else raw.replace('--- FAIL:', '--- SKIP:',1),raw.replace(package,package+'-wrong'),raw+'=== RUN   '+names[0]+'\n'):
                    with self.assertRaises(ValueError): history.qualify(bad,slug,index,status)
                with self.assertRaises(ValueError): history.qualify(raw,slug,index,1-status)
                if not positive:
                    for signal_exit in (124,130,137,143):
                        with self.assertRaises(ValueError): history.qualify(raw,slug,index,signal_exit)
                for child, outcome in history.EXPECTED_RED_CHILDREN.get((slug,index),{}).items():
                    opposite='PASS' if outcome=='fail' else 'FAIL'
                    wrong=raw.replace('--- '+outcome.upper()+': '+child+' (0.00s)','--- '+opposite+': '+child+' (0.00s)')
                    self.assertNotEqual(wrong,raw)
                    with self.assertRaises(ValueError): history.qualify(wrong,slug,index,status)

    def test_go_verbose_parent_first_and_child_boundaries(self):
        p='TestProductionRoleScriptsPreserveSignedStateAndUnknownResults'; c=p+'/existing-signed-install'
        package='github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
        raw='=== RUN   '+p+'\n=== RUN   '+c+'\n--- FAIL: '+p+' (0.1s)\n    --- FAIL: '+c+' (0.1s)\nFAIL\nFAIL\t'+package+'\t0.1s\nFAIL\n'
        history.qualify(raw,'signed-history',1,1)
        nested=raw.replace('=== RUN   '+c+'\n','=== RUN   '+c+'\n=== RUN   '+c+'/nested\n').replace('    --- FAIL: '+c+' (0.1s)\n','    --- FAIL: '+c+' (0.1s)\n        --- FAIL: '+c+'/nested (0.1s)\n')
        history.qualify(nested,'signed-history',1,1)
        for bad in (nested.replace('=== RUN   '+c+'\n',''), nested.replace('    --- FAIL: '+c+' (0.1s)\n        --- FAIL: '+c+'/nested (0.1s)\n','        --- FAIL: '+c+'/nested (0.1s)\n    --- FAIL: '+c+' (0.1s)\n'), raw.removesuffix('FAIL\n'), raw+'unexpected trailing data\n', 'FAIL\t'+package+'\t0.1s\n'+raw):
            with self.assertRaises(ValueError): history.qualify(bad,'signed-history',1,1)
        for bad in (raw.replace('=== RUN   '+c+'\n',''),raw.replace('    --- FAIL: '+c+' (0.1s)\n',''),raw.replace('--- FAIL: '+p+' (0.1s)\n    --- FAIL: '+c+' (0.1s)\n','    --- FAIL: '+c+' (0.1s)\n--- FAIL: '+p+' (0.1s)\n')):
            with self.assertRaises(ValueError): history.qualify(bad,'signed-history',1,1)

    def test_direct_slash_names_are_limited_to_original_calls(self):
        case,index='journal',2
        package='github.com/JiahaoAlbus/YNX-Chain/internal/consensus'
        lines=[]
        for name in history.CASES[case,index][1]:
            children=list(c for c in history.REQUIRED_CHILDREN.get((case,index),()) if c.startswith(name+'/'))
            if name=='TestPQEngineStateReadKeepsPinnedHistoricalRuntimeDomains': children.append(name+'/atomic-json/12')
            lines.append('=== RUN   '+name)
            lines.extend('=== RUN   '+c for c in children)
            lines.append('--- PASS: '+name+' (0.1s)')
            lines.extend('    --- PASS: '+c+' (0.1s)' for c in children)
        raw='\n'.join(lines)+'\nok\t'+package+'\t0.1s\n'
        history.qualify(raw,case,index,0)
        with self.assertRaises(ValueError): history.qualify(raw.replace('/atomic-json/12','/atomic-json/99'),case,index,0)

    def test_artifact_requires_every_original_source_bound_log(self):
        import hashlib,json,os,subprocess,sys,tempfile
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)/'ynx-pq-history-public';d.mkdir()
            source='a'*40
            for (case,index),(positive,names) in history.CASES.items():
                package='github.com/JiahaoAlbus/YNX-Chain/'+('cmd/ynx-consensus-key-init' if case=='ceremony' and index==3 else 'cmd/ynx-comet' if case=='comet-layout' else 'internal/consensus')
                raw=(''.join('=== RUN   '+name+'\n'+''.join('=== RUN   '+c+'\n' for c in history.REQUIRED_CHILDREN.get((case,index),()) if c.startswith(name+'/'))+'--- '+('PASS' if positive else 'FAIL')+': '+name+' (0.00s)\n'+''.join('    --- '+history.EXPECTED_RED_CHILDREN.get((case,index),{}).get(c, 'pass' if positive else 'fail').upper()+': '+c+' (0.00s)\n' for c in history.REQUIRED_CHILDREN.get((case,index),()) if c.startswith(name+'/')) for name in names)+('ok' if positive else 'FAIL')+'\t'+package+'\t0.1s\n'+('' if positive else 'FAIL\n')).encode()
                (d/f'{case}-{index}.log').write_bytes(raw)
                status=0 if positive else 1
                metadata=dict(case=case,index=index,exit=status,source=source,run='123',attempt='1',bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),events=history.qualify(raw.decode(),case,index,status))
                (d/f'{case}-{index}.json').write_text(json.dumps(metadata))
            env=dict(os.environ,RUNNER_TEMP=tmp,GITHUB_SHA=source,GITHUB_RUN_ID='123',GITHUB_RUN_ATTEMPT='1')
            run=lambda: subprocess.run([sys.executable,'-B',str(root/'pq-history-qualify-ci.py')],env=env,capture_output=True)
            self.assertEqual(run().returncode,0)
            original=(d/'journal-1.log').read_bytes();(d/'journal-1.log').write_bytes(original+b'altered')
            self.assertNotEqual(run().returncode,0)
            (d/'journal-1.log').write_bytes(original);(d/'journal-1.json').unlink()
            self.assertNotEqual(run().returncode,0)

    def test_history_job_depends_on_original_identity_and_all_five_actual_cases(self):
        import re
        raw=(root.parents[1]/'.github/workflows/resource-market-ci.yml').read_text()
        def check(text):
            def job(name):
                found=re.findall(r'(?ms)^  '+re.escape(name)+r':\n(.*?)(?=^  [a-z][a-z0-9-]*:\n|\Z)',text)
                if len(found)!=1: raise ValueError('missing or duplicate job')
                return found[0]
            focused=job('focused-go');detached=job('detached-source-checks');history_job=job('source-history-counterexamples');delivery=job('protocol-delivery')
            if '    needs: [detached-source-checks, source-history-counterexamples]\n' not in focused: raise ValueError('history is not required')
            route=lambda x: re.findall(r'(?m)^    if: (.+)$',x)
            if route(history_job)!=route(detached) or 'continue-on-error:' in history_job: raise ValueError('history route weakened')
            if 'ref: ${{ github.sha }}' not in history_job or 'python3 -B scripts/verify/pq-ci-replay-entry-identity.py' not in history_job: raise ValueError('source identity missing')
            pairs=(('Verify original key ceremony retains partial custody and never creates during resume','ceremony'),('Reproduce signed-history overwrite and unsafe rollback callers','signed-history'),('Reproduce source-authority initialization coupling and verify independent execution','source-authority'),('Reproduce JSON-only signing source and verify real journal recovery','journal'),('Reproduce atomic-only Comet operator startup and verify normal journal selection','comet-layout'))
            for name,slug in pairs:
                pattern=r'(?ms)^      - name: '+re.escape(name)+r'\n(.*?)(?=^      - (?:name:|uses:)|\Z)'
                matches=re.findall(pattern,history_job)
                expected_condition="${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (success() && !cancelled() && steps.identity.outcome == 'success') }}"
                if len(matches)!=1 or re.findall(r'(?m)^        if: (.+)$',matches[0]) != [expected_condition] or 'run: bash scripts/verify/pq-history-'+slug+'-ci.sh' not in matches[0] or 'continue-on-error:' in matches[0]: raise ValueError('history case missing or bypassed')
                source=(root/('pq-history-'+slug+'-ci.sh')).read_text()
                if 'reuse-pq-history-counterexamples.sh' in source or 'source scripts/verify/pq-history-events-ci.sh' not in source or 'YNX_HISTORY_EVENT_CASE='+slug not in source or 'test ! -e "$YNX_HISTORY_EVENT_DIR/$YNX_HISTORY_EVENT_CASE.invalid"' not in source: raise ValueError('history execution or event check absent')
            for name in ('Verify same-run history and Finalize event controls','Compile same-source history test dependencies without running tests','Qualify the twelve original history test event streams','Retain only same-run original history test events'):
                match=re.findall(r'(?ms)^      - name: '+re.escape(name)+r'\n(.*?)(?=^      - (?:name:|uses:)|\Z)',history_job)
                expected="${{ !(inputs.consensus_remote_e2e_retained_history || inputs.consensus_fresh_paired_business) && (success() && !cancelled() && steps.identity.outcome == 'success') }}"
                if len(match)!=1 or re.findall(r'(?m)^        if: (.+)$',match[0]) != [expected]: raise ValueError('history evidence control bypassed')
            warm = history_job.split('      - name: Compile same-source history test dependencies without running tests\n',1)[1].split('      - name:',1)[0]
            for part in ('go test -mod=readonly -c -p 1 -o "$RUNNER_TEMP/ynx-history-consensus-prewarm.test" ./internal/consensus', 'go test -mod=readonly -c -p 1 -o "$RUNNER_TEMP/ynx-history-key-init-prewarm.test" ./cmd/ynx-consensus-key-init', 'test -z "$(git status --porcelain --untracked-files=normal)"', 'testsExecuted=false'):
                if part not in warm: raise ValueError('cold compilation prewarm missing')
            result_step=history_job.split('      - name: Retain only same-run original history test events\n',1)[1].split('      - name:',1)[0]
            if 'if-no-files-found: error' not in result_step or 'ynx-history-original-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}' not in result_step: raise ValueError('history successful artifact not required')
            failure_step=history_job.split('      - name: Preserve only partial history failure diagnostics without qualification\n',1)[1].split('      - name:',1)[0]
            if re.findall(r'(?m)^        if: (.+)$',failure_step) != ["${{ failure() && !cancelled() && steps.identity.outcome == 'success' }}"] or 'ynx-history-failure-diagnostics-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}' not in failure_step or 'if-no-files-found: warn' not in failure_step or 'ynx-pq-history-public/*.log' not in failure_step or 'YNX_HISTORY_ORIGINAL_EVENTS_DATA_ONLY' in failure_step: raise ValueError('failure-only public diagnostics weakened or made authoritative')
            if "needs.held-optional-live-source.result == 'success'" not in delivery: raise ValueError('getter not required')
        check(raw)
        for old,new in (('    needs: [detached-source-checks, source-history-counterexamples]','    needs: detached-source-checks'),('python3 -B scripts/verify/pq-ci-replay-entry-identity.py','true'),('run: bash scripts/verify/pq-history-journal-ci.sh','run: true'),('go test -mod=readonly -c -p 1 -o','go test -mod=readonly -p 1 -o'),("success() && !cancelled()","!cancelled()"),("steps.identity.outcome == 'success'","steps.identity.outcome == 'success' && false"),('if-no-files-found: error','if-no-files-found: warn'),('failure() && !cancelled()','success() && !cancelled()'),('ynx-history-failure-diagnostics-','ynx-history-original-')):
            # Alter only the intended history job, not another workflow job.
            if old.startswith('    needs:'): mutated=raw.replace(old,new,1)
            else:
                start=raw.index('  source-history-counterexamples:\n');end=raw.index('  detached-source-checks:\n',start)
                section=raw[start:end];self.assertIn(old,section);mutated=raw[:start]+section.replace(old,new,1)+raw[end:]
            with self.subTest(old=old),self.assertRaises(ValueError):check(mutated)

    def test_finalize_same_package_run_boundaries(self):
        events=[]
        for package,names in finalize.REQUIRED.items():
            events.append({'Package':package,'Action':'start'})
            for name in names:
                events.extend([{'Package':package,'Action':'run','Test':name},{'Package':package,'Action':'pass','Test':name}])
            events.append({'Package':package,'Action':'pass'})
        self.assertEqual(len(finalize.qualify(events)),6)
        for mutate in ('missing','duplicate','foreign','skip','outside'):
            e=[dict(x) for x in events]
            if mutate=='missing': e.pop(1)
            if mutate=='duplicate': e.insert(2,dict(e[1]))
            if mutate=='foreign': e[1]['Package']='other'
            if mutate=='skip': e[2]['Action']='skip'
            if mutate=='outside': e.append(e.pop(1))
            with self.subTest(mutate=mutate),self.assertRaises(ValueError): finalize.qualify(e)

if __name__=='__main__': unittest.main()
