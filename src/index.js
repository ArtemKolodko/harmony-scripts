const fs = require('fs');
const { readCsv, getBalance, getOwners } = require('./utils')

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
