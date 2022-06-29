const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser");
const Web3 = require("web3");
const JSONBigInt = require('json-bigint')

const RPC_API_URL = 'https://a.api.s0.t.hmny.io'
const EXPLORER_API_URL = 'http://api1.explorer.t.hmny.io:3000'

const web3 = new Web3(RPC_API_URL);

const safeAbiRaw = fs.readFileSync('src/assets/GnosisSafeABI.json');
const GnosisSafeAbi = JSON.parse(safeAbiRaw);

const erc20AbiRaw = fs.readFileSync('src/assets/ERC20ABI.json');
const ERC20ABI = JSON.parse(erc20AbiRaw);

const getOneBalance = async (address) => {
    const data = await axios.post(RPC_API_URL, {
            "id": "1",
            "jsonrpc": "2.0",
            "method": "hmyv2_getBalance",
            "params": [
                address
            ]
        },
        {
            transformResponse: (response) => JSONBigInt({ storeAsString: true }).parse(response)
        }
    )
    return data.data.result
}

const hmyCall = async (callParams, blockNumber = 'latest') => {
    const data = await axios.post(RPC_API_URL, {
            "id": "1",
            "jsonrpc": "2.0",
            "method": "hmy_call",
            "params": [
                callParams,
                blockNumber
            ]
        },
        {
            transformResponse: (response) => JSONBigInt({ storeAsString: true }).parse(response)
        }
    )
    return data.data.result
}

const getLatestBlockNumber = async () => {
    const data = await axios.post(RPC_API_URL, {
            "id": "1",
            "jsonrpc": "2.0",
            "method": "hmy_blockNumber",
            "params": []
        }
    )
    return parseInt(data.data.result, 16)
}

const getGnosisSafeOwners = (address) => {
    const contract = new web3.eth.Contract(GnosisSafeAbi, address);
    return contract.methods.getOwners().call();
}

const getERC20Balance = (address, tokenAddress) => {
    const contract = new web3.eth.Contract(ERC20ABI, tokenAddress);
    return contract.methods.balanceOf(address).call();
}

const getAddressErc20Tokens = async (address) => {
    const { data } = await axios.get(`${EXPLORER_API_URL}/v0/erc20/address/${address}/balances`)
    return data
}

const getAllErc20 = async () => {
    const { data } = await axios.get(`${EXPLORER_API_URL}/v0/erc20`)
    return data
}

const getBridgeTokens = async () => {
    const { data } = await axios.get(`https://be4.bridge.hmny.io/tokens/?page=0&size=1000`)
    return data.content
}

const readCsv = (filename) => {
    const lines = []
    return new Promise((resolve, reject) => {
        fs.createReadStream(filename)
            .pipe(csv())
            .on('data', (row) => {
                lines.push(row)
            })
            .on('end', () => {
                resolve(lines);
            })
            .on('error', reject)
    })
}

const sleep = (timeout) => new Promise(resolve => setTimeout(resolve, timeout))

module.exports = {
    readCsv,
    getLatestBlockNumber,
    getOneBalance,
    getERC20Balance,
    getGnosisSafeOwners,
    getAddressErc20Tokens,
    getBridgeTokens,
    getAllErc20,
    sleep,
    hmyCall,
}
