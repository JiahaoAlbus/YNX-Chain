import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseP04SourceArchive, readP04PinnedAsset, verifyP04ArchiveMembers} from './p04-finite-get-consumer-ci.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const dependencies = path.join(directory, 'p04-native-docker-deps');
const goBase = 'golang:1.26.11-bookworm@sha256:79ecd0a7157c7a4cf3b281ced8465350591bf54fedab540e75374a003e1fde7e';
const runtimeBase = 'debian:bookworm-slim@sha256:c67e92c8099ba22853ab4cfda7cfb494d253d6012ca82dee98ba8976772af018';
const buildCommand = ['docker', 'buildx', 'build', '--load', '--platform=linux/amd64', '--target=native', '--metadata-file', './image-metadata.json',
  '--iidfile', './image.id', '--build-context', 'cloud_release_source=./source', '--build-arg', 'CLOUD_NATIVE_GO_BASE=' + goBase,
  '--build-arg', 'CLOUD_NATIVE_RUNTIME_BASE=' + runtimeBase, '-f', './context/infra/docker/ynx-cloudd.Dockerfile', './context'];
const need = (condition, message) => {if (!condition) throw Error('P04 native Docker CI: ' + message);};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyP04NativeDockerInputs(root = dependencies) {
  const read = (file, pin) => readP04PinnedAsset(root, {...pin, file}).raw;
  const handoff = JSON.parse(read('HANDOFF.json', {bytes: 5193, sha256: 'cafd85905d157810f661cfa37e6bbde67adce37066c8a0e6df3f7e0b38448495'}));
  const base = JSON.parse(read('BASE-CONTEXT-HANDOFF.json', handoff.base));
  const release = JSON.parse(read('RELEASE-HANDOFF.json', base.base));
  need(handoff.schema === 'YNX-P04-native-docker-ci-input/2' && base.schema === 'YNX-P04-native-docker-ci-input/1' && release.schema === 'YNX-P04-protected-native-release/1' &&
    handoff.deployed === false && release.deployed === false && release.RootAdmission === false && release.SourceAdmission === false &&
    handoff.goToolchain === 'go1.26.11' && handoff.goDirective === '1.26.10' &&
    release.linkCommit === 'dfcdff3e10a64dc41ec1ce632c4b9d25e377310b' && release.files === 452 &&
    handoff.sourceArchive.bytes === release.archive.bytes && handoff.sourceArchive.sha256 === release.archive.sha256 &&
    JSON.stringify(handoff.buildCommand) === JSON.stringify(buildCommand) &&
    handoff.verifyCommand === 'sh ./context/apps/cloud/scripts/verify-protected-cloud-image.sh "$(cat ./image.id)"', 'original release and exact Docker commands required');
  const manifest = JSON.parse(read('RELEASE-SOURCE-MANIFEST.json', release.sourceManifest));
  const source = parseP04SourceArchive(read('source.tar.gz', handoff.sourceArchive));
  const context = parseP04SourceArchive(read('context.tar.gz', handoff.contextArchive));
  need(manifest.inputs?.length === 452 && handoff.contextFiles?.length === 17, 'complete source and context counts required');
  verifyP04ArchiveMembers(source, manifest.inputs);
  verifyP04ArchiveMembers(context, handoff.contextFiles);
  need(digest(source.files.get('internal/securelink/native/bridge.c')) === '88da89f57e1ee708eb3c503a11448bfa20f5d765ea16fbb807f55899354b7cb2', 'exact Darwin fix in native build source required');
  const updated = ['infra/docker/ynx-cloudd.Dockerfile', 'infra/docker/cloud-native-compose.yml', 'apps/cloud/CONTAINER_OPERATIONS.md'];
  const old = new Map(base.contextFiles.map(pin => [pin.relative, pin]));
  const changed = handoff.contextFiles.filter(pin => pin.sha256 !== old.get(pin.relative)?.sha256).map(pin => pin.relative);
  need(changed.length === updated.length && updated.every(member => changed.includes(member)), 'exact native Dockerfile, Compose and operations delta required');
  const dockerfile = context.files.get(updated[0]).toString('utf8');
  need(dockerfile.includes('ARG CLOUD_NATIVE_GO_BASE=' + goBase + '\n') && dockerfile.includes('ARG CLOUD_NATIVE_RUNTIME_BASE=' + runtimeBase + '\n') &&
    dockerfile.includes('test "$(go env GOVERSION)" = go1.26.11'), 'exact immutable Go and runtime base pins required');
  return {source, context, sourcePins: manifest.inputs, contextPins: handoff.contextFiles, linkCommit: release.linkCommit,
    sourceArchive: handoff.sourceArchive, contextArchive: handoff.contextArchive, buildCommand, goBase, runtimeBase};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [work, evidence] = process.argv.slice(2);
  need(process.argv.length === 4 && process.platform === 'linux' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' &&
    [work, evidence].every(root => path.isAbsolute(root) && fs.realpathSync(path.dirname(root)) === path.dirname(root)) && work !== evidence,
  'original hosted Linux and private runner paths required');
  const verified = verifyP04NativeDockerInputs();
  fs.mkdirSync(work, {mode: 0o700});
  for (const [name, archive] of [['source', verified.source], ['context', verified.context]]) {
    for (const [relative, bytes] of archive.files) {
      const destination = path.join(work, name, relative);
      fs.mkdirSync(path.dirname(destination), {mode: 0o700, recursive: true});
      fs.writeFileSync(destination, bytes, {flag: 'wx', mode: 0o600});
    }
  }
  const {source, context, ...receipt} = verified;
  fs.writeFileSync(path.join(evidence, 'INPUTS.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
}
