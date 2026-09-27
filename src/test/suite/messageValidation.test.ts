import * as assert from 'assert';
import { validateWebviewMessage } from '../../webview/messageTypes';

describe('Message Validation Test Suite', () => {
  it('Validates executeCommand message correctly', () => {
    const validMessage = { type: 'executeCommand', command: 'KODRA.indexWorkspace' };
    const validated = validateWebviewMessage(validMessage);
    assert.deepStrictEqual(validated, validMessage);
  });

  it('Rejects invalid executeCommand message', () => {
    const invalidMessage = { type: 'executeCommand' }; // missing command string
    const validated = validateWebviewMessage(invalidMessage);
    assert.strictEqual(validated, null);
  });

  it('Validates setProvider message correctly', () => {
    const validMessage = { type: 'setProvider', provider: 'openai' };
    const validated = validateWebviewMessage(validMessage);
    assert.deepStrictEqual(validated, validMessage);
  });

  it('Rejects invalid setProvider message', () => {
    const invalidMessage = { type: 'setProvider', provider: 123 }; // provider is not a string
    const validated = validateWebviewMessage(invalidMessage);
    assert.strictEqual(validated, null);
  });
});
