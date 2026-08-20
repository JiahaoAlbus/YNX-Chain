import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const dockerfilePath = new URL('../../../infra/docker/ynx-cloudd.Dockerfile', import.meta.url)
const composePath = new URL('../../../infra/docker/cloud-compose.yml', import.meta.url)
const ignorePath = new URL('../../../infra/docker/ynx-cloudd.Dockerfile.dockerignore', import.meta.url)

test('Cloud container is bounded, non-root, and health checked', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8')

  assert.match(dockerfile, /FROM golang:1\.25-alpine AS build/)
  assert.match(dockerfile, /CGO_ENABLED=0 go build/)
  assert.match(dockerfile, /USER 10001:10001/)
  assert.match(dockerfile, /VOLUME \["\/var\/lib\/ynx-cloud"\]/)
  assert.match(dockerfile, /\/health\/live/)
  assert.match(dockerfile, /COPY --chown=10001:10001 apps\/cloud\/web/)
  assert.doesNotMatch(dockerfile, /apps\/docs/)
  assert.doesNotMatch(dockerfile, /dev-wallet/)
})

test('Cloud Docker context excludes unrelated repository products', async () => {
  const ignore = await readFile(ignorePath, 'utf8')

  assert.equal(ignore.split('\n')[0], '**')
  assert.match(ignore, /!internal\/cloud\/\*\*/)
  assert.match(ignore, /!apps\/cloud\/web\/\*\*/)
  assert.doesNotMatch(ignore, /apps\/docs/)
})

test('Compose runs Cloud with least privilege and persistent state', async () => {
  const compose = await readFile(composePath, 'utf8')
  const cloudStart = compose.indexOf('  ynx-cloudd:')
  const volumesStart = compose.indexOf('\nvolumes:')

  assert.notEqual(cloudStart, -1)
  assert.notEqual(volumesStart, -1)
  const cloud = compose.slice(cloudStart, volumesStart)

  assert.match(cloud, /dockerfile: infra\/docker\/ynx-cloudd\.Dockerfile/)
  assert.match(cloud, /read_only: true/)
  assert.match(cloud, /- ALL/)
  assert.match(cloud, /no-new-privileges:true/)
  assert.match(cloud, /ynx-cloud-data:\/var\/lib\/ynx-cloud/)
  assert.match(cloud, /127\.0\.0\.1:8092\/health\/live/)
  assert.doesNotMatch(cloud, /docs-ui/)
  assert.doesNotMatch(cloud, /dev-wallet/)
})
