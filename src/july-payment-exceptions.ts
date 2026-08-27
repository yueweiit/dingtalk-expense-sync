export type JulyPaymentExceptionCategory =
  | 'paid_in_july_completed_in_august'
  | 'submitted_in_july_still_running';

export interface ReviewedJulyPaymentException {
  businessId: string;
  paidAt: string;
  sourceHash: string;
  amount: number;
  amountSource: 'form_amount_fallback' | 'manual_confirmed';
  reviewCategory: JulyPaymentExceptionCategory;
}

/**
 * Explicitly reviewed one-time records. Keep this list closed: adding a
 * business ID requires a new local review and an updated verification note.
 */
export const REVIEWED_JULY_PAYMENT_EXCEPTIONS: readonly ReviewedJulyPaymentException[] = Object.freeze([
  {
    businessId: '202604240022000364816',
    paidAt: '2026-07-27T15:56:00.000Z',
    sourceHash: '1dedf63b1030e3b5c5ca03a4d64840b037b704bb3c806bbfa3578c0874071dab',
    amount: 29.3,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
  {
    businessId: '202606301549000536602',
    paidAt: '2026-07-14T17:55:00.000Z',
    sourceHash: '81d58db77f9a3a3f3300e69a8724bc8dbd11b3660793626964dc57b734ea9e13',
    amount: 613.9,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
  {
    businessId: '202607031629000547360',
    paidAt: '2026-07-24T14:15:00.000Z',
    sourceHash: '48be3253eeec7d68d3fb4309296b0dcced449b15008f9bab1becc0528093a124',
    amount: 9944.15,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
  {
    businessId: '202607081602000519289',
    paidAt: '2026-07-20T09:27:00.000Z',
    sourceHash: '87458091e2f3f44f20094bb5fbbed112b4ecb6ab8e239ba37215f39d575965ed',
    amount: 180,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
  {
    businessId: '202607101618000152875',
    paidAt: '2026-07-17T14:12:00.000Z',
    sourceHash: '45e12a194c0ff912086a7882dae7233d15095ef65f2ebf96282045089dd28eb0',
    amount: 241.17,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
  {
    businessId: '202607131054000037454',
    paidAt: '2026-07-24T15:15:00.000Z',
    sourceHash: 'b599982b426c916cace5c4851437daa4f0ab3226ee839de610fb12b312b12261',
    amount: 130,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
  {
    businessId: '202607131752000379378',
    paidAt: '2026-07-24T15:14:00.000Z',
    sourceHash: '4823df8de0a0b176b1ffbf4eb854914c081ee6e50b73f0548bc97c7ed4135eba',
    amount: 300,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
  {
    businessId: '202607141608000440840',
    paidAt: '2026-07-20T16:38:00.000Z',
    sourceHash: '05d8894fc2aa00900458296307c02c80887b3c9ead09101d8c7e78c6dcfc4eda',
    amount: 1100,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
  {
    businessId: '202607150207000370144',
    paidAt: '2026-07-28T11:10:00.000Z',
    sourceHash: 'f3c12bfa5685cb2ecc22990ed1f9316fffc231ef6307504431d5dac9fb828285',
    amount: 1920,
    amountSource: 'manual_confirmed',
    reviewCategory: 'submitted_in_july_still_running',
  },
  {
    businessId: '202607161417000511811',
    paidAt: '2026-07-27T17:02:00.000Z',
    sourceHash: '76256bd2567fe6733c5ba2efd169ff1d34692259b4b14268cd4e907f431b64e2',
    amount: 2400,
    amountSource: 'form_amount_fallback',
    reviewCategory: 'paid_in_july_completed_in_august',
  },
]);
