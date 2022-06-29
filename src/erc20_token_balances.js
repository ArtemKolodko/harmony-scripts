require('dotenv').config()
const { Client } = require('pg')
const BigNumber = require('bignumber.js')
const fs = require("fs");
const {ABIManager} = require("./ABIManager");
const {arrayChunk, sleep} = require("./utils");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const erc20AbiRaw = fs.readFileSync('src/assets/ERC20ABI.json');
const erc20AbiManager = ABIManager(JSON.parse(erc20AbiRaw))

const dbParams = {
    host: process.env.PG_HOST || 'localhost',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'harmony_original',
    port: process.env.PG_PORT || 5432
}

const TargetBlockNumber = parseInt(process.env.BLOCK_NUMBER || '0')
const ERC20TokensList = [{
    name: '1ETH',
    address: '0x6983D1E6DEf3690C4d616b13597A09e6193EA013',
}]

const getTokenHolders = async (client, tokenAddress, offset = 0, limit = 10000) => {
    const { rows } = await client.query(`
        select owner_address as address from public.erc20_balance
        where token_address = '${tokenAddress}'
        order by owner_address desc, token_address desc
        offset ${offset}
        limit ${limit}
    `)
    return rows
}

const getAllTokenHolders = async (client, tokenAddress) => {
    let offset = 0
    const limit = 10000
    const addresses = []

    while(true) {
        const rows = await getTokenHolders(client, tokenAddress, offset, limit)
        addresses.push(...rows.map(row => row.address))
        if (rows.length > 0) {
            offset += limit
        } else {
            break
        }
        if (offset > 10 * 1000 * 1000) { // Emergency stop
            break
        }
    }

    return addresses
}

const getUserBalance = async (tokenAddress, userAddress, blockNumber) => {
    const balance = await erc20AbiManager.call('balanceOf', [userAddress], tokenAddress, blockNumber)
    return {
        token: tokenAddress,
        address: userAddress,
        amount: balance,
        blockNumber
    }
}

const runPromisesWithRetry = async (promises, retryCount = 1) => {
    try {
        const data = await Promise.all(promises)
        return data
    } catch (e) {
        console.log('Promise failed: ',e.message, ', retries: ', retryCount, ', sleep 1s')
        await sleep(1000)
        return await runPromisesWithRetry(promises, retryCount + 1)
    }
}

const getHoldersBalancesAtBlock = async (tokenAddress, userAddresses, blockNumber) => {
    const accounts = []
    const chunks = arrayChunk(userAddresses, 100)

    for(let i=0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const promises = chunk.map((userAddress) => getUserBalance(tokenAddress, userAddress, blockNumber))
        const data = await runPromisesWithRetry(promises)
        accounts.push(...data)
        console.log(`Received ${data.length} balances, received total balances: ${accounts.length}`)
    }
    return accounts
}

const upsertFile = async (name) => {
    try {
        await fs.promises.readFile(name)
    } catch (error) {
        await fs.promises.writeFile(name, '')
    }
}

const writeHoldersToCsv = async (holders, filename) => {
    const csvWriter = createCsvWriter({
        path: filename,
        header: [
            {id: 'token', title: 'Token'},
            {id: 'address', title: 'Address'},
            {id: 'amount', title: 'Amount'},
            {id: 'blockNumber', title: 'BlockNumber'},
        ]
    });
    await upsertFile(filename)
    await csvWriter.writeRecords(holders)
}

const start = async () => {
    console.log('Trying to establish explorer DB connection...', dbParams)
    const client = new Client(dbParams)
    await client.connect()

    console.log('Connected')

    const reportsFolder = './reports/erc20_' + Date.now()
    fs.mkdirSync(reportsFolder, { recursive: true });

    for(let i=0; i < ERC20TokensList.length; i++) {
        const token = ERC20TokensList[i]
        const tokenAddress = token.address.toLowerCase()
        try {
            console.log(`${token.name}: getting holders list from DB`)
            const holders = await getAllTokenHolders(client, tokenAddress)
            console.log(`${token.name}: found ${holders.length} holders in DB`)

            console.log(`${token.name}: start updating balances at block "${TargetBlockNumber}"`)
            const holdersWithBalances = await getHoldersBalancesAtBlock(tokenAddress, holders, TargetBlockNumber)
            const reportFileName = `${reportsFolder}/token_${token.name}_block_${TargetBlockNumber}.csv`
            await writeHoldersToCsv(holdersWithBalances, reportFileName)
            console.log(`Report ${reportFileName} created`)
        } catch (e) {
            console.log('Cannot get ', token.name, 'holders: ', e.message)
        }
    }

    client.end()
}

start()
