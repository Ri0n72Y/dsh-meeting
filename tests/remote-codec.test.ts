import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contribution } from '../src/ui/remote.js'

test('all six Meeting Remotes provide strict Session ID parameters', () => {
  assert.equal(contribution.descriptors.length, 6)
  for (const descriptor of contribution.descriptors) {
    assert.equal(descriptor.parameters.length, 1, descriptor.method)
    const [parameter] = descriptor.parameters
    assert.equal(parameter?.name, 'sessionId', descriptor.method)
    const codec = parameter?.codec
    if (codec?.mode !== 'strict') {
      throw new Error(`${descriptor.method}: sessionId must have a strict codec`)
    }
    assert.equal(codec.typeSymbol, '@ri0n72y/dsh-meeting#SessionId')
    const schema = codec.create()
    assert.equal(schema.parse('session:one'), 'session:one')
    assert.throws(() => schema.parse(''), /sessionId must be a non-empty string/)
    assert.throws(() => schema.parse(1), /sessionId must be a non-empty string/)
    assert.throws(() => schema.parse(null), /sessionId must be a non-empty string/)
    assert.equal(descriptor.result.mode, 'src-json')
  }
})
