const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const {
  developmentChains,
  networkConfig,
} = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Lottery unit test", () => {
      let lottery, vrfCoordinator, lotteryEntranceFee, deployer, interval;
      const chainId = network.config.chainId;

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer;
        await deployments.fixture(["all"]);
        lottery = await ethers.getContract("Lottery", deployer);
        vrfCoordinator = await ethers.getContract(
          "VRFCoordinatorV2Mock",
          deployer
        );
        lotteryEntranceFee = await lottery.getEntranceFee();
        interval = await lottery.getInterval();
      });

      describe("constructor", () => {
        it("Initializes the lottery correctly", async () => {
          const lotteryState = await lottery.getLotteryState();
          assert.equal(lotteryState.toString(), "0");
          assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
        });
      });

      describe("enterLottery", () => {
        it("reverts when you don't pay enough", async () => {
          await expect(lottery.enterLottery()).to.be.revertedWithCustomError(
            lottery,
            "Lottery__NotEnoughETHEntered"
          );
        });

        it("adds players when they enter", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          const playerFromContract = await lottery.getPlayers(0);
          assert.equal(playerFromContract, deployer);
        });

        it("emits event on entrance", async () => {
          await expect(
            lottery.enterLottery({ value: lotteryEntranceFee })
          ).to.emit(lottery, "LotteryEnter");
        });

        it("doesnt allow to enter lottery when in calculating stage", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          //*We pretend to be a Chainlink Keeper
          await lottery.performUpkeep([]);
          await expect(
            lottery.enterLottery({ value: lotteryEntranceFee })
          ).to.be.revertedWithCustomError(lottery, "Lottery__NotOpen");
        });
      });

      describe("checkUpkeep", () => {
        it("returns false if people haven't sent any ETH", async () => {
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded);
        });

        it("returns false if lottery is not in open state", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          await lottery.performUpkeep([]);
          const lotteryState = await lottery.getLotteryState();
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert.equal(lotteryState.toString(), "1");
          assert.equal(upkeepNeeded, false);
        });

        it("returns false if enough time hasn't passed", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() - 5,
          ]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded);
        });

        it("returns true if enough time has passed, have players, eth, and is open", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(upkeepNeeded);
        });
      });

      describe("performUpkeep", () => {
        it("can only run if checkUpkeep is true", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const tx = await lottery.performUpkeep([]);
          assert(tx);
        });

        it("reverts when checkUpkeep is false", async () => {
          await expect(lottery.performUpkeep([])).to.be.revertedWithCustomError(
            lottery,
            "Lottery__UpkeepNotNeeded"
          );
        });

        it("updates the lottery state, emits an event and calls the vrfCoordinator", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const txResponse = await lottery.performUpkeep([]);
          const txReceipt = await txResponse.wait(1);
          const requestId = await txReceipt.events[1].args.requestId;
          const lotteryState = await lottery.getLotteryState();
          assert(requestId.toNumber() > 0);
          assert(lotteryState.toString() == "1");
        });
      });

      describe("fulfillRandomWords", () => {
        beforeEach(async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [
            interval.toNumber() + 1,
          ]);
          await network.provider.send("evm_mine", []);
        });

        it("can only be called after performUpkeep", async () => {
          await expect(
            vrfCoordinator.fulfillRandomWords(0, lottery.address)
          ).to.be.revertedWith("nonexistent request");
          await expect(
            vrfCoordinator.fulfillRandomWords(1, lottery.address)
          ).to.be.revertedWith("nonexistent request");
        });

        it("picks a winner, resets, and sends money", async () => {
          const aditionalEntrance = 3;
          const startingAccountIndex = 1;
          const accounts = await ethers.getSigners();
          for (
            let i = startingAccountIndex;
            i < startingAccountIndex + aditionalEntrance;
            i++
          ) {
            const accountCoonectedLottery = lottery.connect(accounts[i]);
            await accountCoonectedLottery.enterLottery({
              value: lotteryEntranceFee,
            });
          }
          const startingTimeStamp = await lottery.getLastTimeStamp();
          await new Promise(async (resolve, reject) => {
            lottery.once("WinnerPicked", async () => {
              console.log("found the event!");
              try {
                const recentWinner = await lottery.getRecentWinner();
                const lotteryState = await lottery.getLotteryState();
                const endingTimeStamp = await lottery.getLastTimeStamp();
                const numPlayers = await lottery.getNumberOfPlayers();
                const winnerEndingBalance = await accounts[1].getBalance();
                assert.equal(recentWinner.toString(), accounts[1].address);
                assert.equal(numPlayers, 0);
                assert.equal(lotteryState, 0);
                assert(endingTimeStamp > startingTimeStamp);
                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(
                    lotteryEntranceFee
                      .mul(aditionalEntrance)
                      .add(lotteryEntranceFee)
                      .toString()
                  )
                );
                resolve();
              } catch (e) {
                reject(e);
              }
            });
            const tx = await lottery.performUpkeep([]);
            const txReceipt = await tx.wait(1);
            const winnerStartingBalance = await accounts[1].getBalance();
            await vrfCoordinator.fulfillRandomWords(
              txReceipt.events[1].args.requestId,
              lottery.address
            );
          });
        });
      });
    });
