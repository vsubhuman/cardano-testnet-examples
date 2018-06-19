//const PRIVATEKEY = ''

// IMPORTANT: after 'npm install' you must apply the following patch to node_modules/web3-eth-accounts/src/index.js
// 179,182c179,182
// <                 transaction.data,
// <                 Bytes.fromNat(transaction.chainId || "0x1"),
// <                 "0x",
// <                 "0x"]);
// —-
// >                 transaction.data]);
// >                 //Bytes.fromNat(transaction.chainId || "0x1"),
// >                 //"0x",
// >                 //"0x"]);
// 187c187,188
// <             var signature = Account.makeSigner(Nat.toNumber(transaction.chainId || "0x1") * 2 + 35)(Hash.keccak256(rlpEncoded), privateKey);
// —-
// >             //var signature = Account.makeSigner(Nat.toNumber(transaction.chainId || "0x1") * 2 + 35)(Hash.keccak256(rlpEncoded), privateKey);
// >             var signature = Account.makeSigner(27)(Hash.keccak256(rlpEncoded), privateKey);

const Web3 = require('web3')
const crypto = require('crypto')
const request = require('request-promise-native')

const TARGET_ACCOUNT_BALANCE = 40000000000000000
const FAUCET_INTERVAL = 60000  // to prevent faucet error (too many requests in given amount of time)

process.on('unhandledRejection', err => {
  console.log(err);
});

const providerUrl = 'https://kevm-testnet.iohkdev.io:8546'
//const providerUrl = 'http://localhost:3000'

const run = async () => {
  const web3 = new Web3(providerUrl)

  // ******************************
  // Step 1 - create an account
  // To create an account, you need a random private key. This portion of the 
  // script will create a random key string that can simply be added to the top
  // of the script so it can be re-run with the same account.
  // ******************************

  try {
    var account = web3.eth.accounts.privateKeyToAccount(PRIVATEKEY)
  } catch (err) {
    const rand = crypto.randomBytes(32).toString('hex')
    console.log("No private key - generating random key.")
    console.log("- add the following line to the top of the script and re-run:")
    console.log("const PRIVATEKEY = '0x" + rand + "'");
    process.exit()
  }
  const res = web3.eth.accounts.wallet.add(account)

  // ******************************
  // Step 2 - fund the account
  // If the account balance is zero, here we request test tokens from the IOHK faucet
  // and wait until the account is funded.
  // ******************************

  console.log("Account = " + account.address)
  let balance = parseInt(await web3.eth.getBalance(account.address), 10)
  console.log("Account balance = " + balance)
  while (balance <= TARGET_ACCOUNT_BALANCE) {
    await new Promise(async (res,rej) => {
      console.log("Requesting more test tokens from faucet (waiting " + FAUCET_INTERVAL / 1000 + " seconds)")
      const url = "https://kevm-testnet.iohkdev.io:8099/faucet?address=" + account.address
      try {
        await request.post(url)
      } catch (err) {
        console.log(err.message)
        process.exit()
      }
      var funded = false
      const interval = setInterval(async () => {
        const newbalance = parseInt(await web3.eth.getBalance(account.address), 10)
        if (newbalance > balance) {
          res()
          clearInterval(interval)
        }
      }, FAUCET_INTERVAL)
    })
    balance = parseInt(await web3.eth.getBalance(account.address), 10)
    console.log("Account balance = " + balance)
  }

  // ******************************
  // Step 3 - compile the contract
  // Use the solcjs package to obtain the abi and binary for the following Solidity source
  // ******************************

  console.log("Compiling contract...")
  const solc = require('solc')
  const contractSource = `

    // Test Solidity Contract
    pragma solidity ^0.4.0;

    contract Counter {
      int private count = 0;
      function incrementCounter() public {
        count += 1;
      }
      function decrementCounter() public {
        count -= 1;
      }
      function getCount() public constant returns (int) {
        return count;
      }
    }

  `
  const output = solc.compile(contractSource, 1)
  const abi = output.contracts[':Counter'].interface
  const bin = output.contracts[':Counter'].bytecode
  //console.log("abi=" + abi)
  //console.log("bin=" + bin)

  // ******************************
  // Step 4 - deploy the contract
  // ******************************
  console.log("Deploying contract...")
  const contract = new web3.eth.Contract(JSON.parse(abi))
  const deployed = await contract.deploy({
    data: "0x" + bin
  }).send({
    from: account.address,
    gas: 5000000,
    gasPrice: 5000000000
  })

  // ******************************
  // Step 5 - test deployed contract
  // ******************************
  if (deployed.options.address !== undefined) {
    console.log("Contract address=" + deployed.options.address)
    const instance = new web3.eth.Contract(JSON.parse(abi), deployed.options.address)
    // Test setter and getter
    const beforeCount = await instance.methods.getCount().call()
    console.log("Count before=" + beforeCount)
    await instance.methods.incrementCounter().send({
      from: account.address,
      gas: 100000,
      gasPrice: 5000000000
    })
    const afterCount = await instance.methods.getCount().call()
    console.log("Count after=" + afterCount)
  }

}

try {
  run()
} catch (err) {
  console.log(err)
}

