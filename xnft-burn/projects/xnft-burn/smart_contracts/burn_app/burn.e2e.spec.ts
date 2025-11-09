import { Config, microAlgo, microAlgos } from "@algorandfoundation/algokit-utils";
import { registerDebugEventHandlers } from "@algorandfoundation/algokit-utils-debug";
import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import { type Account } from "algosdk";
import { beforeAll, describe, expect, test } from "vitest";

import { BurnAppClient } from "../artifacts/burn_app/BurnAppClient";
import { ASSET_FEE, BOOTSTRAP_FEE, BURN_FEE, BURN_PAYMENT, WITHDRAW_FEE } from "./config.algo";
import { deploy } from "./burn-deploy";

const localnet = algorandFixture();

const burnFeeMicroAlgo = BigInt(BURN_FEE);
const burnPaymentUnits = BigInt(BURN_PAYMENT);
const bootstrapFeeMicroAlgo = Number(BOOTSTRAP_FEE);
const assetOptInFee = Number(ASSET_FEE);
const withdrawFeeMicroAlgo = Number(WITHDRAW_FEE);
let appClient: BurnAppClient;

type TestContext = {
  burnClient: BurnAppClient;
  managerAccount: Account;
  recognizedCreator: Account;
  collectorAccount: Account;
  outsiderAccount: Account;
};

const deployBurnApp = async (): Promise<TestContext> => {
  await localnet.newScope();

  const { generateAccount } = localnet.context;

  const managerAccount = await generateAccount({ initialFunds: microAlgo(25_000_000) });
  const recognizedCreator = await generateAccount({ initialFunds: microAlgo(10_000_000) });
  const collectorAccount = await generateAccount({ initialFunds: microAlgo(10_000_000) });
  const outsiderAccount = await generateAccount({ initialFunds: microAlgo(10_000_000) });

  const appClient = await deploy(managerAccount);

  localnet.algorand.setDefaultSigner(managerAccount);
  appClient.algorand.setSignerFromAccount(managerAccount);
  await localnet.algorand.send.payment({
    sender: managerAccount.addr,
    receiver: appClient.appAddress,
    amount: microAlgos(1_000_000),
  });

  return { burnClient: appClient, managerAccount, recognizedCreator, collectorAccount, outsiderAccount };
};

describe("BurnApp contract", () => {
  beforeAll(() => {
    Config.configure({ debug: true });
    registerDebugEventHandlers();
  });

  test("enforces manager-only creator management", async () => {
    const { burnClient, managerAccount, recognizedCreator, outsiderAccount } = await deployBurnApp();
    const globalStateBefore = await burnClient.state.global.getAll();
    console.log("Global state at deployment:", globalStateBefore);
    expect(await burnClient.state.global.managerAddress()).toEqual(managerAccount.addr.toString());

    burnClient.algorand.setSignerFromAccount(managerAccount);

    await burnClient.send.addCreator({
      args: {
        creatorAddress: recognizedCreator.addr.toString(),
        appId: 123n,
      },
      sender: managerAccount.addr,
    });

    let globalState = await burnClient.state.global.getAll();
    expect(globalState.numCreators).toEqual(1n);
    burnClient.algorand.setSignerFromAccount(outsiderAccount);

    await expect(
      burnClient.send.addCreator({
        sender: outsiderAccount.addr,
        args: {
          creatorAddress: outsiderAccount.addr.toString(),
          appId: 999n,
        },
      })
    ).rejects.toThrow(/Only the manager can add creators/);

    burnClient.algorand.setSignerFromAccount(managerAccount);

    await burnClient.send.removeCreator({
      args: {
        creatorAddress: recognizedCreator.addr.toString(),
      },
    });

    globalState = await burnClient.state.global.getAll();
    expect(globalState.numCreators).toEqual(0n);
  });

  test("bootstraps reward asset and restricts withdrawals", async () => {
    const { burnClient, managerAccount, outsiderAccount } = await deployBurnApp();

    burnClient.algorand.setSignerFromAccount(managerAccount);

    const rewardAssetId = (
      await burnClient.algorand.send.assetCreate({
        sender: managerAccount.addr,
        total: 10_000_000_000n,
        decimals: 6,
        defaultFrozen: false,
        unitName: "xNFT",
        assetName: "xNFT Reward",
        manager: managerAccount.addr,
        reserve: managerAccount.addr,
      })
    ).assetId;

    const bootstrapMbrTxn = burnClient.algorand.createTransaction.payment({
      sender: managerAccount.addr,
      receiver: burnClient.appAddress,
      amount: microAlgos(bootstrapFeeMicroAlgo),
    });

    await burnClient.send.bootstrap({
      args: {
        xnftAssetId: rewardAssetId,
        mbrTxn: bootstrapMbrTxn,
      },
    });

    const depositAmount = burnPaymentUnits * 2n;
    await burnClient.algorand.send.assetTransfer({
      sender: managerAccount.addr,
      receiver: burnClient.appAddress,
      assetId: rewardAssetId,
      amount: depositAmount,
    });

    let appHolding = await burnClient.algorand.asset.getAccountInformation(burnClient.appAddress, rewardAssetId);
    expect(appHolding.balance).toEqual(depositAmount);

    const outsiderWithdrawMbrTxn = burnClient.algorand.createTransaction.payment({
      sender: outsiderAccount.addr,
      receiver: burnClient.appAddress,
      amount: microAlgos(withdrawFeeMicroAlgo),
    });

    burnClient.algorand.setSignerFromAccount(outsiderAccount);
    await expect(
      burnClient.send.withdrawTokens({
        sender: outsiderAccount.addr,
        args: {
          mbrTxn: outsiderWithdrawMbrTxn,
          amount: 1n,
          assetId: rewardAssetId,
        },
      })
    ).rejects.toThrow(/Only the manager can withdraw funds/);

    const withdrawAmount = burnPaymentUnits;
    burnClient.algorand.setSignerFromAccount(managerAccount);

    const managerWithdrawMbrTxn = burnClient.algorand.createTransaction.payment({
      sender: managerAccount.addr,
      receiver: burnClient.appAddress,
      amount: microAlgos(withdrawFeeMicroAlgo),
    });

    await burnClient.send.withdrawTokens({
      args: {
        mbrTxn: managerWithdrawMbrTxn,
        amount: withdrawAmount,
        assetId: rewardAssetId,
      },
    });

    appHolding = await burnClient.algorand.asset.getAccountInformation(burnClient.appAddress, rewardAssetId);
    expect(appHolding.balance).toEqual(depositAmount - withdrawAmount);
  });

  test("burns NFTs, rewards collectors, and tracks totals", async () => {
    const { burnClient, managerAccount, recognizedCreator, collectorAccount } = await deployBurnApp();
    burnClient.algorand.setSignerFromAccount(managerAccount);

    await burnClient.send.addCreator({
      args: {
        creatorAddress: recognizedCreator.addr.toString(),
        appId: 555n,
      },
    });

    const rewardAssetId = (
      await burnClient.algorand.send.assetCreate({
        sender: managerAccount.addr,
        total: 10_000_000_000n,
        decimals: 6,
        defaultFrozen: false,
        unitName: "xNFT",
        assetName: "xNFT Reward",
        manager: managerAccount.addr,
        reserve: managerAccount.addr,
      })
    ).assetId;

    const bootstrapMbrTxn = burnClient.algorand.createTransaction.payment({
      sender: managerAccount.addr,
      receiver: burnClient.appAddress,
      amount: microAlgos(bootstrapFeeMicroAlgo),
    });

    await burnClient.send.bootstrap({
      args: {
        xnftAssetId: rewardAssetId,
        mbrTxn: bootstrapMbrTxn,
      },
    });

    const liquidityAmount = burnPaymentUnits * 2n;
    await burnClient.algorand.send.assetTransfer({
      sender: managerAccount.addr,
      receiver: burnClient.appAddress,
      assetId: rewardAssetId,
      amount: liquidityAmount,
    });
    burnClient.algorand.setSignerFromAccount(recognizedCreator);

    const nftAssetId = (
      await burnClient.algorand.send.assetCreate({
        sender: recognizedCreator.addr,
        total: 1n,
        decimals: 0,
        defaultFrozen: false,
        unitName: "BRN",
        assetName: "Burnable NFT",
        manager: recognizedCreator.addr,
        reserve: recognizedCreator.addr,
      })
    ).assetId;

    burnClient.algorand.setSignerFromAccount(collectorAccount);
    await burnClient.algorand.send.assetTransfer({
      sender: collectorAccount.addr,
      receiver: collectorAccount.addr,
      assetId: nftAssetId,
      amount: 0n,
    });

    await burnClient.algorand.send.assetTransfer({
      sender: collectorAccount.addr,
      receiver: collectorAccount.addr,
      assetId: rewardAssetId,
      amount: 0n,
    });

    burnClient.algorand.setSignerFromAccount(recognizedCreator);
    await burnClient.algorand.send.assetTransfer({
      sender: recognizedCreator.addr,
      receiver: collectorAccount.addr,
      assetId: nftAssetId,
      amount: 1n,
    });

    burnClient.algorand.setSignerFromAccount(managerAccount);
    const collectorRewardSeed = burnPaymentUnits + 5n;
    await burnClient.algorand.send.assetTransfer({
      sender: managerAccount.addr,
      receiver: collectorAccount.addr,
      assetId: rewardAssetId,
      amount: collectorRewardSeed,
    });

    burnClient.algorand.setSignerFromAccount(collectorAccount);
    const optInMbrTxn = burnClient.algorand.createTransaction.payment({
      sender: collectorAccount.addr,
      receiver: burnClient.appAddress,
      amount: microAlgos(assetOptInFee),
    });


    await burnClient.send.optInToAsset({
      sender: collectorAccount.addr,
      args: {
        asset: nftAssetId,
        mbrTxn: optInMbrTxn,
      },
    });

    await burnClient.algorand.send.assetTransfer({
      sender: collectorAccount.addr,
      receiver: burnClient.appAddress,
      assetId: nftAssetId,
      amount: 1n,
    });

    const burnFeeCover = Number(burnFeeMicroAlgo * 3n);
    const burnMbrTxn = burnClient.algorand.createTransaction.payment({
      sender: collectorAccount.addr,
      receiver: burnClient.appAddress,
      amount: microAlgos(burnFeeCover),
    });

    const axferTxn = burnClient.algorand.createTransaction.assetTransfer({
      sender: collectorAccount.addr,
      receiver: burnClient.appAddress,
      assetId: rewardAssetId,
      amount: 1n,
    });

    await burnClient.send.burnNft({
      sender: collectorAccount.addr,
      args: {
        asset: nftAssetId,
        mbrTxn: burnMbrTxn,
        axfer: axferTxn,
        creator: recognizedCreator.addr.toString(),
      },
    });

    const globalState = await burnClient.state.global.getAll();
    expect(globalState.totalBurned).toEqual(1n);

    const creatorHolding = await burnClient.algorand.asset.getAccountInformation(recognizedCreator.addr, nftAssetId);
    expect(creatorHolding.balance).toEqual(1n);

    const collectorHolding = await burnClient.algorand.asset.getAccountInformation(collectorAccount.addr, rewardAssetId);
    const expectedCollectorBalance = collectorRewardSeed - 1n + burnPaymentUnits;
    expect(collectorHolding.balance).toEqual(expectedCollectorBalance);
  });
});
