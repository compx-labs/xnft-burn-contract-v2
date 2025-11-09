import { arc4, uint64 } from '@algorandfoundation/algorand-typescript'

export const ASSET_FEE: uint64 = 101_000; // 0.101 ALGO in microAlgos
export const ASSET_MBR_FEE: uint64 = 100_000; // 0.001 ALGO in microAlgos
export const BURN_FEE: uint64 = 1_000; // 0.002 ALGO in microAlgos
export const BURN_PAYMENT: uint64 = 500_000; // 0.5 ALGO in xnft
export const WITHDRAW_FEE: uint64 = 1_000; // 0.1 ALGO in xnf
export const BOOTSTRAP_FEE: uint64 = 200_000; // 0.2 ALGO in microAlgos

export class CreatorInfo extends arc4.Struct<{
  shuffleAppId: arc4.UintN64
}> {}
