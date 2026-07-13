const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

process.env.DB_PASSWORD ??= 'test-password';
process.env.DINGTALK_APPKEY ??= 'test-appkey';
process.env.DINGTALK_APPSECRET ??= 'test-appsecret';

function getProcessor() {
  const srcPath = path.join('..', 'src', 'processor');
  const distPath = path.join('..', 'dist', 'src', 'processor');
  try {
    const processorModule = require(srcPath);
    return processorModule.default || processorModule;
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    const processorModule = require(distPath);
    return processorModule.default || processorModule;
  }
}

test('extractAttachments parses DingTalk JSON text attachments without download URLs', () => {
  const processor = getProcessor();
  const attachments = processor.extractAttachments([
    {
      name: '关键凭证Comprobante clave',
      value: JSON.stringify([
        { spaceId: 'space-1', fileId: 'file-1', fileName: '采购合同.pdf', fileType: 'pdf' },
        { spaceId: 'space-1', fileId: 'file-2', fileName: '报价单.xlsx', fileType: 'xlsx' },
      ]),
    },
  ]);

  assert.deepEqual(
    attachments.map((attachment) => ({
      attachmentType: attachment.attachmentType,
      fileName: attachment.fileName,
      fileUrl: attachment.fileUrl,
      fileId: attachment.rawData.fileId,
      spaceId: attachment.rawData.spaceId,
    })),
    [
      {
        attachmentType: 'pdf',
        fileName: '采购合同.pdf',
        fileUrl: '',
        fileId: 'file-1',
        spaceId: 'space-1',
      },
      {
        attachmentType: 'xlsx',
        fileName: '报价单.xlsx',
        fileUrl: '',
        fileId: 'file-2',
        spaceId: 'space-1',
      },
    ],
  );
});
