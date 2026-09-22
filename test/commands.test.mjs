import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAdminCommand, parseJobArgument } from '../dist/bot/admin.js'

/**
 * The `run` command is a development aid, so the parsing matters more than
 * usual: a member's ordinary update must never be mistaken for a command.
 */

test('the existing commands still parse', () => {
  for (const word of ['setup', 'status', 'pause', 'resume', 'help']) {
    assert.equal(parseAdminCommand(word), word)
  }
})

test('run with a job name is a command', () => {
  assert.equal(parseAdminCommand('run reminder'), 'run')
  assert.equal(parseJobArgument('run reminder'), 'reminder')
  assert.equal(parseJobArgument('RUN Summary'), 'summary')
  assert.equal(parseJobArgument('run  participation'), 'participation')
})

test('run on its own is a command, with no job named', () => {
  assert.equal(parseAdminCommand('run'), 'run')
  assert.equal(parseJobArgument('run'), undefined)
})

test('a mistyped job is a command, but names no job', () => {
  // The member is shown the valid names rather than having 'run remind'
  // recorded as their stand-up update.
  assert.equal(parseAdminCommand('run remind'), 'run')
  assert.equal(parseJobArgument('run remind'), undefined)
})

test('an ordinary update is never mistaken for a command', () => {
  for (const text of [
    'I ran the tests today',
    'running SCRUM-7 locally',
    'run through the backlog with me',
    'Finished SCRUM-6, starting SCRUM-20'
  ]) {
    assert.equal(parseAdminCommand(text), undefined, text)
  }
})
