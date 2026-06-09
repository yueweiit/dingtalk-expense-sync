const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

function loadModule(moduleName) {
  const distPath = path.join('..', 'dist', 'src', moduleName);
  const srcPath = path.join('..', 'src', moduleName);
  try {
    return require(distPath);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require(srcPath);
  }
}

test('resolveProcessInstanceFetchId prefers stored process instance id', () => {
  const { resolveProcessInstanceFetchId } = loadModule('workflowIds');

  assert.equal(
    resolveProcessInstanceFetchId({ processInstanceId: 'raw-id' }, 'business-id', ' stored-id '),
    'stored-id'
  );
});

test('resolveProcessInstanceFetchId reads processInstanceId from JSON raw data', () => {
  const { resolveProcessInstanceFetchId } = loadModule('workflowIds');

  assert.equal(
    resolveProcessInstanceFetchId('{"processInstanceId":"raw-id"}', 'business-id', null),
    'raw-id'
  );
});

test('resolveProcessInstanceFetchId falls back to business id for malformed raw data', () => {
  const { resolveProcessInstanceFetchId } = loadModule('workflowIds');

  assert.equal(
    resolveProcessInstanceFetchId('{bad-json', 'business-id', undefined),
    'business-id'
  );
});
