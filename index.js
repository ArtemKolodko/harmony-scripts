const axios = require('axios')
const JSONBigInt = require('json-bigint')({'storeAsString': true})
const csv = require('csv-parser');
const fs = require('fs');
const Web3 =  require("web3");

const web3 = new Web3('https://a.api.s0.t.hmny.io');

const getBalance = async (address) => {
    const data = await axios.post('https://api.s0.t.hmny.io', {
        "id": "1",
        "jsonrpc": "2.0",
        "method": "hmyv2_getBalance",
        "params": [
            address
        ]
    },
        { transformResponse: (response) => JSONBigInt.parse(response)}
    )
    return data.data.result
}

const getOwners = (abi, address) => {
    let contract = new web3.eth.Contract(abi, address);
    return contract.methods.getOwners().call();
}

function readCsv(filename){
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

const start = async () => {
    const csvLines = await readCsv('multisig-addresses.csv')
    const addresses = csvLines.map(line => line.address)
    console.log('Safes count:', addresses.length)

    let rawAbi = fs.readFileSync('GnosisSafeAbi.json');
    let gnosisSafeAbi = JSON.parse(rawAbi);

    let totalBalance = BigInt(0)
    const ownersSet = new Set()
    const ownersArray = []
    try {
        for(let i=0; i < addresses.length; i++) {
            const address = addresses[i]
            const balance = await getBalance(address)
            totalBalance = BigInt(totalBalance) + BigInt(balance)

            const owners = await getOwners(gnosisSafeAbi, address)
            owners.forEach((owner) => {
                ownersArray.push(owner)
                ownersSet.add(owner)
            })

            if (i > 0 && i % 100 === 0) {
                console.log(`Proceeded ${i} items, total balance: ${totalBalance.toString()}, unique owners: ${ownersSet.size}`)
            }

            await sleep(20)
        }
    } catch (e) {
        console.log(e)
    }

    console.log('Total balance', totalBalance.toString())
    console.log('Unique owners', ownersSet.size)
    console.log('Total owners', ownersArray.length)
}

start()
