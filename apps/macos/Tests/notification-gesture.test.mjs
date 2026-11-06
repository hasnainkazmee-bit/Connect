import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const swift = readFileSync(new URL('../Sources/NativeNotificationCoordinator.swift', import.meta.url), 'utf8');
const script = swift.match(/static let permissionScript = """\n([\s\S]*?)\n    """;/)?.[1]
  ?? swift.match(/static let permissionScript = """\n([\s\S]*?)\n    """/)?.[1];
assert.ok(script, 'Production isolated-world script is present');
function fixture() {
  const handlers = new Map(), messages = [];
  let now = 100;
  const context = {
    document: { addEventListener: (type, callback) => handlers.set(type, callback) },
    window: {
      addEventListener: (type, callback) => handlers.set(type, callback),
      webkit: { messageHandlers: { connectNotificationPermission: { postMessage: message => messages.push(message) } } },
    },
    performance: { now: () => now },
  };
  vm.runInNewContext(script, context);
  return {
    messages, advance: ms => { now += ms; },
    click: trusted => handlers.get('click')({ type: 'click', isTrusted: trusted }),
    key: (key, trusted = true) => handlers.get('keydown')({ type: 'keydown', key, isTrusted: trusted }),
    request: (id = 'c7417e32-91b7-4d7c-b740-e7343e071782') => handlers.get('connect:native-notification-permission')({detail: {requestId: id}}),
  };
}
test('Only a recent trusted click grants a single permission request', () => {
  const f = fixture();
  f.request(); assert.equal(f.messages.at(-1).permitted, false);
  f.click(false); f.request(); assert.equal(f.messages.at(-1).permitted, false);
  f.click(true); f.request(); assert.equal(f.messages.at(-1).permitted, true);
  f.request(); assert.equal(f.messages.at(-1).permitted, false);
  f.click(true); f.advance(1000); f.request(); assert.equal(f.messages.at(-1).permitted, false);
});
test('Keyboard activation, expiry and request bounds', () => {
  const f = fixture();
  f.key('Enter'); f.request(); assert.equal(f.messages.at(-1).permitted, true);
  f.key(' '); f.request(); assert.equal(f.messages.at(-1).permitted, true);
  f.key('Escape'); f.request(); assert.equal(f.messages.at(-1).permitted, false);
  f.key('Enter', false); f.request(); assert.equal(f.messages.at(-1).permitted, false);
  const count = f.messages.length;
  f.request('anything'); assert.equal(f.messages.length, count);
});
