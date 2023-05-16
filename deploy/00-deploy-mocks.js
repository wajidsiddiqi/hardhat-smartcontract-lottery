const { network } = require("hardhat");
const { developmentChains } = require("../helper-hardhat-config");

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();
  const chainId = network.name;

  if (developmentChains.includes(network.name)) {
    console.log("Local network detected! Deploying mocks...");
  }
};
