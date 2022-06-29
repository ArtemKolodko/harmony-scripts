require('dotenv').config()
const { Client } = require('pg')
const BigNumber = require('bignumber.js')
const fs = require("fs");
const {ABIManager} = require("./ABIManager");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { getLatestBlockNumber } = require('./utils')

const erc20AbiRaw = fs.readFileSync('src/assets/ERC20ABI.json');
const erc20AbiManager = ABIManager(JSON.parse(erc20AbiRaw))

const dbParams = {
    host: process.env.PG_HOST || 'localhost',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'harmony_original',
    port: process.env.PG_PORT || 5432
}

const TargetBlockNumber = 28115058
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

const getHoldersBalancesAtBlock = async (tokenAddress, userAddresses, blockNumber) => {
    const accounts = []
    for(let i = 0; i < userAddresses.length; i++) {
        const holder = userAddresses[i]
        const balance = await erc20AbiManager.call('balanceOf', [holder], tokenAddress, TargetBlockNumber)
        accounts.push({
            token: tokenAddress,
            address: holder,
            amount: balance,
            blockNumber
        })
        if (i !== 0 && i % 10 === 0) {
            console.log('Updated', i, 'balances')
        }
    }
    return accounts
}

const upsertFile = async (name) => {
    try {
        // try to read file
        await fs.promises.readFile(name)
    } catch (error) {
        // create empty file, because it wasn't found
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
            {id: 'blockNumber', title: 'blockNumber'},
        ]
    });
    await upsertFile(filename)
    await csvWriter.writeRecords(holders)
}

const start = async () => {
    console.log('Trying to establish explorer DB connection...', dbParams)
    const client = new Client(dbParams)
    await client.connect()

    console.log('Connected, start retrieving erc20 holders')
    const currentBlockNumber = await getLatestBlockNumber()
    console.log('current block number:', currentBlockNumber)

    const reportsFolder = './reports/erc20_' + Date.now()
    fs.mkdirSync(reportsFolder, { recursive: true });

    for(let i=0; i < ERC20TokensList.length; i++) {
        const token = ERC20TokensList[i]
        const tokenAddress = token.address.toLowerCase()
        try {
            const holders = await getAllTokenHolders(client, tokenAddress)
            console.log(`${token.name}: found ${holders.length} holders in database`)

            console.log('Start updating balances at old block', TargetBlockNumber)
            const reportOldBLockFileName = `${reportsFolder}/token_${token.name}_block_${TargetBlockNumber}.csv`
            const holdersAtOldBLock = await getHoldersBalancesAtBlock(tokenAddress, holders, TargetBlockNumber)
            await writeHoldersToCsv(holdersAtOldBLock, reportOldBLockFileName)
            console.log(`Report ${reportOldBLockFileName} created`)

            console.log('Started updating balances at current block:', currentBlockNumber)
            const reportCurrentBlockFileName = `${reportsFolder}/token_${token.name}_block_${currentBlockNumber}.csv`
            const holdersAtCurrentBlock = await getHoldersBalancesAtBlock(tokenAddress, holders, currentBlockNumber)
            await writeHoldersToCsv(holdersAtCurrentBlock, reportCurrentBlockFileName)
            console.log(`Report ${reportCurrentBlockFileName} created`)
        } catch (e) {
            console.log('Cannot get ', token.name, 'holders: ', e.message)
        }
    }

    client.end()
}

start()
