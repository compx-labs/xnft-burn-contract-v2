import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import { BurnAppFactory } from "../artifacts/burn_app/BurnAppClient";
import algosdk, { type Account } from "algosdk";

export const deploy = async ( deployer: Account) => {
  const localnet = algorandFixture();
  await localnet.newScope(); // Ensure context is initialized before accessing it
  localnet.algorand.setSignerFromAccount(deployer);

  const factory = localnet.algorand.client.getTypedAppFactory(BurnAppFactory, {
    defaultSender: deployer.addr,
  });

  const { appClient } = await factory.send.create.createApplication({
    args: {},
    sender: deployer.addr,
    accountReferences: [deployer.addr],
  });
  appClient.algorand.setSignerFromAccount(deployer);
  console.log("app Created, address", algosdk.encodeAddress(appClient.appAddress.publicKey));
  return appClient;
};
