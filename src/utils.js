const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser");
const Web3 = require("web3");
const JSONBigInt = require('json-bigint')

const RPC_API_URL = 'https://a.api.s0.t.hmny.io'

const web3 = new Web3(RPC_API_URL);

const getBalance = async (address) => {
    const data = await axios.post(RPC_API_URL, {
            "id": "1",
            "jsonrpc": "2.0",
            "method": "hmyv2_getBalance",
            "params": [
                address
            ]
        },
        { transformResponse: (response) => JSONBigInt({ storeAsString: true }).parse(response)}
    )
    return data.data.result
}

const getOwners = (abi, address) => {
    const contract = new web3.eth.Contract(abi, address);
    return contract.methods.getOwners().call();
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

module.exports = {
    readCsv,
    getBalance,
    getOwners
}
