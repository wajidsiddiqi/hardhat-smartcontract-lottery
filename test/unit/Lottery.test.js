const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const {
  developmentChains,
  networkConfig,
} = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Lottery unit test", async () => {
      let lottery, vrfCoordinator;
      const chainId = network.config.chainId;

      beforeEach(async () => {
        const { deployer } = await getNamedAccounts();
        await deployments.fixture(["all"]);
        lottery = await ethers.getContract("Lottery", deployer);
        vrfCoordinator = await ethers.getContract(
          "VRFCoordinatorV2Mock",
          deployer
        );
      });

      describe("constructor", async () => {
        it("Initializes the lottery correctly", async () => {
          const lotteryState = await lottery.getLotteryState();
          const interval = await lottery.getInterval();
          assert.equal(lotteryState.toString(), "0");
          assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
        });
      });
    });
