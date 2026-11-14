import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnedListenerCapturePlan } from '../platform-probe/capture-plan.mjs';

test('reviewed capture retains a kernel packet/snapshot bound and exact owned IPv4/IPv6 tuples', () => {
  const listeners = [
    {host:'127.0.0.1',port:21443,transport:'tcp',pid:4321},
    {host:'::1',port:23478,transport:'udp',pid:4321}
  ];
  const plan = buildOwnedListenerCapturePlan({runID:'capture-bound',listeners,durationSeconds:20,maximumPackets:1000000});
  const args = plan.arguments;
  assert.equal(args[args.indexOf('-c') + 1], '512');
  assert.equal(args[args.indexOf('-s') + 1], '256');
  assert.equal(args[args.indexOf('-i') + 1], 'lo0');
  assert.equal(args.at(-1), '((tcp and host 127.0.0.1 and port 21443) or (udp and host ::1 and port 23478))');
  assert.equal(plan.maximumClassicPCAPBytes,24 + 512 * (16 + 256));
  assert.equal(plan.automaticallyElevates,false);
});

test('a review request cannot widen to physical hosts, wildcard listeners or an unbounded duration', () => {
  for (const host of ['0.0.0.0','::','192.0.2.1','example.com']) {
    assert.throws(() => buildOwnedListenerCapturePlan({runID:'capture-bound',listeners:[{host,port:21443,transport:'tcp',pid:4321}]}));
  }
  assert.throws(() => buildOwnedListenerCapturePlan({runID:'capture-bound',listeners:[{host:'127.0.0.1',port:21443,transport:'tcp',pid:4321}],durationSeconds:31}));
});
