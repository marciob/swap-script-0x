require("dotenv").config();
const axios = require("axios");
const ethers = require("ethers");
const qs = require("qs");

const API_KEY = process.env.ZEROX_API_KEY;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const RPC_PROVIDER_URL = process.env.RPC_PROVIDER_URL;

// initialize a JsonRpcProvider with ethers
const provider = new ethers.providers.JsonRpcProvider(RPC_PROVIDER_URL);

const wallet = new ethers.Wallet(WALLET_PRIVATE_KEY, provider);

async function getQuote(sellToken, buyToken, sellAmount) {
  const params = { sellToken, buyToken, sellAmount };

  // the URL to get a quote from the 0x API
  // in this example it uses the Base chain API endpoint
  const requestUrl = `https://base.api.0x.org/swap/v1/quote?${qs.stringify(
    params
  )}`;
  console.log("Request URL:", requestUrl); // Log the request URL

  const response = await axios.get(requestUrl, {
    headers: { "0x-api-key": API_KEY },
  });

  return response.data;
}

// Add this function to your existing code
async function setAllowanceIfNeeded(tokenAddress, spenderAddress, amount) {
  const ERC20_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) public returns (bool)",
  ];

  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const tokenWithSigner = tokenContract.connect(wallet);

  // Check current allowance
  const currentAllowance = await tokenContract.allowance(
    wallet.address,
    spenderAddress
  );
  if (currentAllowance.lt(amount)) {
    console.log("Setting allowance for token...");
    const approveTx = await tokenWithSigner.approve(spenderAddress, amount);
    await approveTx.wait();
    console.log(`Allowance set. Transaction hash: ${approveTx.hash}`);
  } else {
    console.log("Sufficient allowance already set.");
  }
}

async function executeSwap(quote, retryCount = 3, retryDelay = 3000) {
  for (let attempt = 0; attempt < retryCount; attempt++) {
    try {
      const increasedGasLimit = ethers.BigNumber.from(quote.gas).mul(2); // Example: doubling the gas estimate

      const tx = {
        from: wallet.address,
        to: quote.to,
        data: quote.data,
        value: ethers.BigNumber.from(quote.value),
        gasPrice: ethers.BigNumber.from(quote.gasPrice),
        gasLimit: increasedGasLimit,
      };

      const transaction = await wallet.sendTransaction(tx);
      console.log(`Transaction hash: ${transaction.hash}`);

      const receipt = await transaction.wait();
      console.log(`Transaction confirmed in block: ${receipt.blockNumber}`);
      return; // Exit the function after successful execution
    } catch (error) {
      console.error(
        `Attempt ${attempt + 1}: Swap execution failed. Retrying in ${
          retryDelay / 1000
        } seconds.`
      );
      console.error(error.message);
      if (attempt < retryCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay)); // Wait before retrying
      }
    }
  }

  throw new Error("All swap execution attempts failed.");
}

// WETH = 0x4200000000000000000000000000000000000006
// ETH = 0x0000000000000000000000000000000000000000

async function main() {
  try {
    const sellToken = "0x4200000000000000000000000000000000000006"; // Native token (e.g., ETH)
    const buyToken = "0xE3086852A4B125803C815a158249ae468A3254Ca"; // Token to buy
    const sellAmount = ethers.utils.parseEther("0.00001"); // Amount of ETH to sell

    console.log("Fetching quote for the swap...");
    const quote = await getQuote(sellToken, buyToken, sellAmount.toString());
    console.log(
      `Quote received: Sell ${sellAmount} ETH for ${quote.buyAmount} of the buy token`
    );

    // Check and set allowance if needed
    const allowanceTarget = quote.allowanceTarget; // This should come from your quote response
    const allowanceAmount = ethers.utils.parseEther("1"); // For example, set to 1 WETH; adjust as needed
    await setAllowanceIfNeeded(sellToken, allowanceTarget, allowanceAmount);

    console.log("Executing swap...");
    await executeSwap(quote);
    console.log("Swap executed successfully");
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error("Error Data:", error.response.data);
      console.error("Error Status:", error.response.status);
      console.error("Error Headers:", error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error("No response received:", error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error("Error:", error.message);
    }
  }
}

main();
