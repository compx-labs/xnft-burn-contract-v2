import {
  Account,
  assert,
  assertMatch,
  Asset,
  BoxMap,
  Contract,
  Global,
  GlobalState,
  gtxn,
  itxn,
  Txn,
  uint64,
} from "@algorandfoundation/algorand-typescript";
import { WITHDRAW_FEE, ASSET_FEE, BURN_FEE, BURN_PAYMENT, ASSET_MBR_FEE, CreatorInfo, BOOTSTRAP_FEE } from "./config.algo";
import { abimethod, Address, UintN64 } from "@algorandfoundation/algorand-typescript/arc4";

const CONTRACT_VERSION: uint64 = 3000;

export class BurnApp extends Contract {
  manager_address = GlobalState<Account>();
  total_burned = GlobalState<uint64>();
  xnft_asset_id = GlobalState<uint64>();

  num_creators = GlobalState<uint64>();
  contract_version = GlobalState<uint64>();

  creators = BoxMap<Address, CreatorInfo>({ keyPrefix: "creator_" });

  @abimethod({ allowActions: "NoOp", onCreate: "require" })
  createApplication() {
    this.manager_address.value = Txn.sender;
    this.total_burned.value = 0;
    this.num_creators.value = 0;
    this.contract_version.value = CONTRACT_VERSION;
  }

  @abimethod({ allowActions: "NoOp" })
  public addCreator(creatorAddress: Account, appId: uint64) {
    assert(Txn.sender === this.manager_address.value, "Only the manager can add creators");
    assert(creatorAddress !== Global.zeroAddress, "Invalid creator address");
    assert(this.creators(new Address(creatorAddress)).exists === false, "Creator already exists");

    const creator = new CreatorInfo({
      shuffleAppId: new UintN64(appId),
    });

    this.creators(new Address(creatorAddress)).value = creator.copy();
    this.num_creators.value = this.num_creators.value + 1;
  }

  @abimethod({ allowActions: "NoOp" })
  public removeCreator(creatorAddress: Account) {
    assert(Txn.sender === this.manager_address.value, "Only the manager can remove creators");
    assert(this.creators(new Address(creatorAddress)).exists === true, "Creator does not exist");

    this.creators(new Address(creatorAddress)).delete();
    this.num_creators.value = this.num_creators.value - 1;
  }

  @abimethod({ allowActions: "NoOp" })
  bootstrap(xnft_asset_id: uint64, mbrTxn: gtxn.PaymentTxn) {
    assert(Txn.sender === this.manager_address.value, "Only the manager can bootstrap the application");
    assert(xnft_asset_id > 0, "Invalid xnft asset ID");

    assertMatch(mbrTxn, {
      amount: BOOTSTRAP_FEE,
      sender: Txn.sender,
      receiver: Global.currentApplicationAddress,
    });

    this.xnft_asset_id.value = xnft_asset_id;
    this.total_burned.value = 0;

    itxn
      .assetTransfer({
        xferAsset: Asset(xnft_asset_id),
        assetAmount: 0,
        assetReceiver: Global.currentApplicationAddress,
        fee: ASSET_MBR_FEE,
      })
      .submit();
  }

  @abimethod({ allowActions: "NoOp" })
  public withdraw_tokens(mbrTxn: gtxn.PaymentTxn, amount: uint64, asset_id: uint64) {
    assert(amount > 0, "Withdrawal amount must be greater than zero");
    assert(Txn.sender === this.manager_address.value, "Only the manager can withdraw funds");
    assert(asset_id === this.xnft_asset_id.value, "Can only withdraw xnft asset");

    assertMatch(mbrTxn, {
      amount: WITHDRAW_FEE,
      sender: Txn.sender,
      receiver: Global.currentApplicationAddress,
    });

    itxn
      .assetTransfer({
        assetReceiver: Txn.sender,
        assetAmount: amount,
        xferAsset: asset_id,
        fee: WITHDRAW_FEE,
      })
      .submit();
  }

  @abimethod({ allowActions: "NoOp" })
  opt_in_to_asset(asset: Asset, mbrTxn: gtxn.PaymentTxn) {
    assert(this.creators(new Address(asset.creator)).exists === true, "NFT creator is not recognized");

    assertMatch(mbrTxn, {
      amount: ASSET_FEE,
      sender: Txn.sender,
      receiver: Global.currentApplicationAddress,
    });

    itxn
      .assetTransfer({
        xferAsset: asset,
        assetAmount: 0,
        assetReceiver: Global.currentApplicationAddress,
        fee: 1_000,
      })
      .submit();
  }

  @abimethod({ allowActions: "NoOp" })
  burn_nft(asset: Asset, mbrTxn: gtxn.PaymentTxn, axfer: gtxn.AssetTransferTxn, creator: Account) {
    assert(this.creators(new Address(asset.creator)).exists === true, "NFT creator is not recognized");

    assertMatch(axfer, {
      xferAsset: Asset(this.xnft_asset_id.value),
      assetAmount: 1,
      assetReceiver: Global.currentApplicationAddress,
      sender: Txn.sender,
    });

    assertMatch(mbrTxn, {
      amount: BURN_FEE * 3,
      sender: Txn.sender,
      receiver: Global.currentApplicationAddress,
    });

    itxn
      .assetTransfer({
        xferAsset: this.xnft_asset_id.value,
        assetAmount: BURN_PAYMENT,
        assetReceiver: Txn.sender,
        fee: BURN_FEE,
      })
      .submit();

    itxn
      .assetTransfer({
        xferAsset: asset.id,
        assetAmount: 1,
        assetReceiver: creator,
        fee: BURN_FEE,
      })
      .submit();

    itxn
      .assetTransfer({
        xferAsset: asset.id,
        assetAmount: 0,
        assetReceiver: Txn.sender,
        assetCloseTo: creator,
        fee: BURN_FEE,
      })
      .submit();

    itxn
      .payment({
        amount: ASSET_MBR_FEE,
        receiver: Txn.sender,
        fee: BURN_FEE,
      })
      .submit();

    this.total_burned.value = this.total_burned.value + 1;
  }
}
