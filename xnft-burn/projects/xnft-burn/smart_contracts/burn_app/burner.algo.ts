import { Account, assert, Asset, Contract, Global, GlobalState, gtxn, itxn, Txn, uint64 } from "@algorandfoundation/algorand-typescript";

const ASSET_FEE:uint64 = 101_000; // 0.101 ALGO in microAlgos
const BURN_FEE:uint64 = 1_000; // 0.002 ALGO in microAlgos
const BURN_PAYMENT:uint64 = 500_000; // 0.5 ALGO in xnft
const WITHDRAW_FEE:uint64 = 1_000; // 0.1 ALGO in xnf

export class BurnApp extends Contract {
  manager_address = GlobalState<Account>();
  total_burned = GlobalState<uint64>();
  xnft_asset_id = GlobalState<uint64>();

  createApplication() {
    this.manager_address.value = Txn.sender;
    this.total_burned.value = 0;
  }

  bootstrap(xnft_asset_id: uint64, mbrTxn: gtxn.PaymentTxn) {
    assert(Txn.sender === this.manager_address.value, "Only the manager can bootstrap the application");
    assert(xnft_asset_id > 0, "Invalid xnft asset ID");
    this.xnft_asset_id.value = xnft_asset_id;
    this.total_burned.value = 0;
    this.opt_in_to_asset(xnft_asset_id, mbrTxn);
  }

  withdraw_tokens(mbrTxn: gtxn.PaymentTxn, amount: uint64, asset_id: uint64) {
    assert(amount > 0, "Withdrawal amount must be greater than zero");
    assert(Txn.sender === this.manager_address.value, "Only the manager can withdraw funds");
    assert(mbrTxn.amount >= WITHDRAW_FEE, "Insufficient fee for fund withdrawal");
    itxn
      .assetTransfer({
        assetReceiver: Txn.sender,
        assetAmount: amount,
        xferAsset: asset_id,
        fee: WITHDRAW_FEE,
      })
      .submit();
  }

  opt_in_to_asset(asset: uint64, mbrTxn: gtxn.PaymentTxn) {
    assert(mbrTxn.amount >= ASSET_FEE, "Insufficient fee for asset opt-in");

    itxn
      .assetTransfer({
        xferAsset: asset,
        assetAmount: 0,
        assetReceiver: Global.currentApplicationAddress,
        fee: 1_000,
      })
      .submit();
  }

  burn_nft(asset: Asset, mbrTxn: gtxn.PaymentTxn, axfer: gtxn.AssetTransferTxn) {
    assert(axfer.assetAmount === 1, "NFT must be burned with exactly 1 unit");
    assert(axfer.assetReceiver === Global.currentApplicationAddress, "NFT must be sent to the application address");
    assert(mbrTxn.amount >= BURN_FEE, "Insufficient fee for NFT burn");
    assert(asset.balance(Global.currentApplicationAddress) >= BURN_PAYMENT, "Insufficient balance in xnft for burn payment");

    itxn
      .assetTransfer({
        xferAsset: this.xnft_asset_id.value,
        assetAmount: BURN_PAYMENT,
        assetReceiver: Txn.sender,
        fee: BURN_FEE,
      })
      .submit();

      this.total_burned.value = this.total_burned.value + 1;
  }
}
