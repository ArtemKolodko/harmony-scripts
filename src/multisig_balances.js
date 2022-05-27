const { readCsv, getOneBalance, getGnosisSafeOwners, sleep } = require('./utils')

const start = async () => {
    const csvLines = await readCsv('./assets/multisig-addresses.csv')
    const addresses = csvLines.map(line => line.address)
    console.log('Safes count:', addresses.length)
    console.log('Start counting balances...')

    let totalBalance = BigInt(0)
    const ownersSet = new Set()
    try {
        for(let i=0; i < addresses.length; i++) {
            const address = addresses[i]
            const balance = await getOneBalance(address)
            totalBalance = BigInt(totalBalance) + BigInt(balance)

            const owners = await getGnosisSafeOwners(address)
            owners.forEach((owner) => {
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
}

start()
