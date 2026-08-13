import { describe, it, expect } from 'vitest';

const { buildUpdateImportItemPayload, APPROVED, REJECTED } = require('../../lib/vsdc-gateway/payloadBuilders/updateImportItem');

const CTX = { tpin: '1000000000', bhfId: '000' };

function itemFixture(overrides = {}) {
  return {
    taskCd: '4561614',
    dclDe: '20260801',
    itemSeq: 1,
    hsCd: '22029900000',
    ...overrides,
  };
}

function productFixture(overrides = {}) {
  return {
    sku: 'COKE500',
    zraClassificationCode: 'BVRG001',
    ...overrides,
  };
}

describe('buildUpdateImportItemPayload', () => {
  it('sets imptItemSttsCd to 3 (Approved) for an APPROVED decision', () => {
    const payload = buildUpdateImportItemPayload(itemFixture(), productFixture(), 'APPROVED', null, CTX);
    expect(payload.importItemList[0].imptItemSttsCd).toBe(APPROVED);
    expect(APPROVED).toBe('3');
  });

  it('sets imptItemSttsCd to 4 (Rejected) for a REJECTED decision', () => {
    const payload = buildUpdateImportItemPayload(itemFixture(), productFixture(), 'REJECTED', null, CTX);
    expect(payload.importItemList[0].imptItemSttsCd).toBe(REJECTED);
    expect(REJECTED).toBe('4');
  });

  it('carries taskCd/dclDe/itemSeq/hsCd through unchanged from the retrieved item', () => {
    const item = itemFixture({ taskCd: 'TASK-X', dclDe: '20260805', itemSeq: 2, hsCd: '85176200000' });
    const payload = buildUpdateImportItemPayload(item, productFixture(), 'APPROVED', null, CTX);
    expect(payload.taskCd).toBe('TASK-X');
    expect(payload.dclDe).toBe('20260805');
    expect(payload.importItemList[0].itemSeq).toBe(2);
    expect(payload.importItemList[0].hsCd).toBe('85176200000');
  });

  it('derives itemCd from product.sku and itemClsCd from product.zraClassificationCode', () => {
    const payload = buildUpdateImportItemPayload(
      itemFixture(),
      productFixture({ sku: 'MYSKU', zraClassificationCode: '50101500' }),
      'APPROVED',
      null,
      CTX
    );
    expect(payload.importItemList[0].itemCd).toBe('MYSKU');
    expect(payload.importItemList[0].itemClsCd).toBe('50101500');
  });

  it('falls back to zraItemClassification when zraClassificationCode is absent', () => {
    const payload = buildUpdateImportItemPayload(
      itemFixture(),
      { sku: 'MYSKU', zraItemClassification: '50101500' },
      'APPROVED',
      null,
      CTX
    );
    expect(payload.importItemList[0].itemClsCd).toBe('50101500');
  });

  it('defaults modrNm/modrId to SYSTEM when no actor is given', () => {
    const payload = buildUpdateImportItemPayload(itemFixture(), productFixture(), 'APPROVED', null, CTX);
    expect(payload.importItemList[0].modrNm).toBe('SYSTEM');
    expect(payload.importItemList[0].modrId).toBe('SYSTEM');
  });

  it('uses the actor name/id when provided', () => {
    const payload = buildUpdateImportItemPayload(
      itemFixture(),
      productFixture(),
      'APPROVED',
      { name: 'jane@example.com', id: 'user-1' },
      CTX
    );
    expect(payload.importItemList[0].modrNm).toBe('jane@example.com');
    expect(payload.importItemList[0].modrId).toBe('user-1');
  });

  it('includes tpin/bhfId from vsdcCtx and the remark when given', () => {
    const payload = buildUpdateImportItemPayload(
      itemFixture(),
      productFixture(),
      'REJECTED',
      null,
      CTX,
      'not ours'
    );
    expect(payload.tpin).toBe(CTX.tpin);
    expect(payload.bhfId).toBe(CTX.bhfId);
    expect(payload.importItemList[0].remark).toBe('not ours');
  });

  it('importItemList always has exactly one line — one decide call per item', () => {
    const payload = buildUpdateImportItemPayload(itemFixture(), productFixture(), 'APPROVED', null, CTX);
    expect(payload.importItemList).toHaveLength(1);
  });
});
