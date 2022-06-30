require('dotenv').config()
const moment = require('moment');
const { Client } = require('pg')
const BigNumber = require('bignumber.js')
const fs = require("fs");
const {ABIManager} = require("./ABIManager");
const {arrayChunk, sleep} = require("./utils");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

BigNumber.config({ DECIMAL_PLACES: 20, EXPONENTIAL_AT: 20 })

const erc20AbiRaw = fs.readFileSync('src/assets/ERC20ABI.json');
const erc20AbiManager = ABIManager(JSON.parse(erc20AbiRaw))

const settings = {
    balancesBatchSize: parseInt(process.env.BALANCES_BATCH_SIZE || '100'),
    sleepBetweenBatches: parseInt(process.env.SLEEP_BETWEEN_BATCHES || '1000'),
}

const dbParams = {
    host: process.env.PG_HOST || 'localhost',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'harmony_original',
    port: process.env.PG_PORT || 5432
}

const TargetBlockNumber = parseInt(process.env.BLOCK_NUMBER || '0')
const ERC20TokensList = [
    { name: '1ETH', address: '0x6983D1E6DEf3690C4d616b13597A09e6193EA013'},
    { name: '1USDC', address: '0x985458E523dB3d53125813eD68c274899e9DfAb4'},
    { name: '1WBTC', address: '0x3095c7557bCb296ccc6e363DE01b760bA031F2d9'},
    { name: '1USDT', address: '0x3C2B8Be99c50593081EAA2A724F0B8285F5aba8f'},
    { name: '1DAI', address: '0xEf977d2f931C1978Db5F6747666fa1eACB0d0339'},
    { name: '1BUSD', address: '0xE176EBE47d621b984a73036B9DA5d834411ef734'},
    { name: '1AAG', address: '0xAE0609A062a4eAED49dE28C5f6A193261E0150eA'},
    { name: '1FXS', address: '0x775d7816afbEf935ea9c21a3aC9972F269A39004'},
    { name: '1SUSHI', address: '0xBEC775Cb42AbFa4288dE81F387a9b1A3c4Bc552A'},
    { name: '1AAVE', address: '0xcF323Aad9E522B93F11c352CaA519Ad0E14eB40F'},
    { name: '1WETH', address: '0xF720b7910C6b2FF5bd167171aDa211E226740bfe'},
    { name: '1FRAX', address: '0xeB6C08ccB4421b6088e581ce04fcFBed15893aC3'},
    { name: 'bscBNB', address: '0xb1f6E61E1e113625593a22fa6aa94F8052bc39E0'},
    { name: 'bscBUSD', address: '0x0aB43550A6915F9f67d0c454C2E90385E6497EaA'},
]

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
    // const json = fs.readFileSync(`src/assets/holders/holders_${tokenAddress}_block_28115058.csv`);
    // return JSON.parse(json)
}

const getUserBalance = async (tokenAddress, tokenDecimals, userAddress, blockNumber) => {
    const balance = await erc20AbiManager.call('balanceOf', [userAddress], tokenAddress, blockNumber)
    let balanceFormatted = new BigNumber(balance).dividedBy(Math.pow(10, tokenDecimals))
    if (balanceFormatted.isGreaterThan(new BigNumber('1'))) {
        balanceFormatted = balanceFormatted.decimalPlaces(4)
    }
    return {
        address: userAddress,
        balance: balanceFormatted.toString(10),
    }
}

const getTokenDecimals = (tokenAddress) => {
    return erc20AbiManager.call('decimals', [], tokenAddress, 'latest')
}

const runPromisesWithRetry = async (promises, retryCount = 1) => {
    try {
        const data = await Promise.all(promises)
        return data
    } catch (e) {
        const sleepTimeout = 30
        console.log('Promise failed: ',e.message, ', retries: ', retryCount, 'sleep: ', sleepTimeout, 's')
        await sleep(sleepTimeout * 1000)
        return await runPromisesWithRetry(promises, retryCount + 1)
    }
}

const getHoldersBalancesAtBlock = async (tokenAddress, tokenDecimals, userAddresses, blockNumber) => {
    const accounts = []
    const chunks = arrayChunk(userAddresses, settings.balancesBatchSize)

    for(let i=0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const promises = chunk.map((userAddress) => getUserBalance(tokenAddress, tokenDecimals, userAddress, blockNumber))
        const data = await runPromisesWithRetry(promises)
        const positiveBalances = data.filter(item => +item.balance > 0)
        accounts.push(...positiveBalances)
        console.log(`Received ${positiveBalances.length} positive balances, total positive balances: ${accounts.length}, total balances checked: ${settings.balancesBatchSize * (i + 1)}`)
        await sleep(settings.sleepBetweenBatches)
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
            {id: 'address', title: 'Address'},
            {id: 'balance', title: 'Balance'},
        ]
    });
    await upsertFile(filename)
    await csvWriter.writeRecords(holders)
}

const start = async () => {
    console.log('settings: ', settings)
    console.log('Trying to establish explorer DB connection...', dbParams)
    const client = new Client(dbParams)
    await client.connect()

    console.log('Connected')

    const reportsFolder = './reports/erc20_' + moment().format()
    fs.mkdirSync(reportsFolder, { recursive: true });

    for(let i=0; i < ERC20TokensList.length; i++) {
        const token = ERC20TokensList[i]
        const tokenAddress = token.address.toLowerCase()
        try {
            console.log(`${token.name}: getting holders list from DB`)
            const holders = await getAllTokenHolders(client, token.name)
            console.log(`${token.name}: found ${holders.length} holders in DB`)

            console.log(`${token.name}: start updating balances at block "${TargetBlockNumber}"`)
            const decimals = await getTokenDecimals(tokenAddress)
            const holdersWithBalances = await getHoldersBalancesAtBlock(tokenAddress, decimals, holders, TargetBlockNumber)
            const reportFileName = `${reportsFolder}/token_${token.address}_block_${TargetBlockNumber}.csv`
            await writeHoldersToCsv(holdersWithBalances, reportFileName)
            console.log(`${token.name}: report ${reportFileName} created`)
        } catch (e) {
            console.log('Cannot get ', token.name, 'holders: ', e.message)
        }
    }

    client.end()
}

start()
