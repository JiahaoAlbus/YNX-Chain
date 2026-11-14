"""Generate an isolated test adapter from CORE's real BlockExecutor fixture.
Never run against an owner checkout. Usage: python3 generate_core_workflow.py COMPOSITION.
No CORE production file or verifier is replaced; output is test-only.
"""
import pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
if 'owners/P06/pq-core-composition-' not in str(root):
    raise SystemExit('isolated P06 composition required')
p = root / 'internal/consensus/pq_transaction_proof_test.go'
s = p.read_text()
imports = s[s.index('import ('):s.index('\n)', s.index('import ('))+2]
imports = imports.replace('"context"', '"context"\n"os"')
imports = '\n'.join(line for line in imports.splitlines() if not any(x in line for x in ['ynxconsensusauth', 'crypto/merkle', 'cmtproto ', 'coretypes ']))
# Only fixture construction is reused. Production verification remains unchanged.
start = s.index('\tt.Helper()', s.index('func newPQTransactionProofFixtureWithProfiles'))
end = s.index('\theight := app.committed.Height + 1', start)
prefix = s[start:end]
prefix = prefix.replace('t.Helper()', 't.Helper()\ninitialAccount, fundedInitial, migrationOnly := false, false, false', 1)
prefix = prefix.replace('d.Faucet(account.owner, 100)', 'd.Faucet(account.owner, 500)')
prefix = prefix.replace('\td.ProduceBlock()', '\tif _, err := d.Faucet(account.other, 500); err != nil { t.Fatal(err) }\n\td.ProduceBlock()', 1)
prefix = prefix.replace('\tt.Cleanup(account.key.Destroy)', '''\tt.Cleanup(account.key.Destroy)
account.otherKey, account.otherPublic, err = ynxbatch.KeyGen()
if err != nil { t.Fatal(err) }; t.Cleanup(account.otherKey.Destroy)''', 1)
prefix = prefix.replace('\th.apply(t, registrations)', '''registrations = append(registrations, mustPQEnvelope(t, PQMigrationType, account.registration(t, true, uint64(f.doc.InitialHeight+1))))
\th.apply(t, registrations)''', 1)
multi = len(sys.argv) == 3 and sys.argv[2] == '--multi-refund'
if len(sys.argv) > 2 and not multi:
    raise SystemExit('only explicit --multi-refund fixture successor is supported')
tail_name = 'core_multi_refund_tail.go.txt' if multi else 'core_workflow_tail.go.txt'
test_name = 'TestExportPayMultiRefundWorkflow' if multi else 'TestExportPayConsumerWorkflow'
file_name = 'pay_multi_refund_workflow_test.go' if multi else 'pay_consumer_workflow_test.go'
if multi:
    imports = '\n'.join(line for line in imports.splitlines()
                        if '"context"' not in line and 'abci "' not in line)
tail = pathlib.Path(__file__).with_name(tail_name).read_text()
(root / 'internal/consensus' / file_name).write_text('package consensus\n'+imports+'\nfunc '+test_name+'(t *testing.T) {\n'+prefix+tail+'\n}\n')
