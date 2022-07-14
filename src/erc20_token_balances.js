require('dotenv').config()
const moment = require('moment');
const BigNumber = require('bignumber.js')
const fs = require("fs");
const {ABIManager} = require("./ABIManager");
const {arrayChunk, sleep} = require("./utils");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

BigNumber.config({ DECIMAL_PLACES: 20, EXPONENTIAL_AT: 20 })

const erc20AbiRaw = fs.readFileSync('src/assets/ERC20ABI.json');
const erc20AbiManager = ABIManager(JSON.parse(erc20AbiRaw))

const settings = {
    balancesBatchSize: parseInt(process.env.BALANCES_BATCH_SIZE || '1000'),
    sleepBetweenBatches: parseInt(process.env.SLEEP_BETWEEN_BATCHES || '10000'),
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

const getAllTokenHolders = async (tokenAddress) => {
    const json = fs.readFileSync(`src/assets/holders/holders_${tokenAddress}_block_28697138.csv`);
    return JSON.parse(json)
}

const readJsonFromFile = async (fileName) => {
    const json = fs.readFileSync(fileName);
    return JSON.parse(json)
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

const getTotalSupply = async (tokenAddress, blockNumber = 'latest', tokenDecimals = 0) => {
    let supply = await erc20AbiManager.call('totalSupply', [], tokenAddress, blockNumber)
    if (tokenDecimals) {
        return new BigNumber(supply).div(Math.pow(10, tokenDecimals)).toString(10)
    }
    return supply
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
    const tempFileName = `./temp/balances_${tokenAddress}.json`
    await upsertFile(tempFileName, JSON.stringify([]))
    const accounts = await readJsonFromFile(tempFileName)
    const allAccounts = [...accounts]
    if (accounts.length > 0) {
        console.log(`Found ${accounts.length} balances in temp file ${tempFileName}`)
    }

    userAddresses = userAddresses.filter(userAddress => !accounts.find(acc => acc.address.toLowerCase() === userAddress.toLowerCase()))

    console.log(`${userAddresses.length} accounts to be updated`)

    const chunks = arrayChunk(userAddresses, settings.balancesBatchSize)

    for(let i=0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const promises = chunk.map((userAddress) => getUserBalance(tokenAddress, tokenDecimals, userAddress, blockNumber))
        const data = await Promise.all(promises)

        allAccounts.push(...data)
        fs.writeFileSync(tempFileName, JSON.stringify(allAccounts))

        const positiveBalances = data.filter(item => +item.balance > 0)
        accounts.push(...positiveBalances)

        console.log(`Received ${positiveBalances.length} positive balances, total positive balances: ${accounts.length}, total balances checked: ${settings.balancesBatchSize * (i + 1)}`)
        await sleep(settings.sleepBetweenBatches)
    }
    return accounts.sort((a, b) => b.balance - a.balance)
}

const upsertFile = async (name, content = '') => {
    try {
        await fs.promises.readFile(name)
    } catch (error) {
        await fs.promises.writeFile(name, content)
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
    const reportsFolder = './reports/balances_erc20_' + moment().format()
    fs.mkdirSync(reportsFolder, { recursive: true });

    for(let i=0; i < ERC20TokensList.length; i++) {
        const token = ERC20TokensList[i]
        const tokenAddress = token.address.toLowerCase()
        try {
            const holders = await getAllTokenHolders(token.name)
            console.log(`${token.name}: found ${holders.length} holders`)

            const decimals = await getTokenDecimals(tokenAddress)
            const totalSupply = await getTotalSupply(tokenAddress, TargetBlockNumber, decimals)
            const holdersWithBalances = await getHoldersBalancesAtBlock(tokenAddress, decimals, holders, TargetBlockNumber)
            const totalCalculatedBalance = holdersWithBalances.reduce((prev, cur) => {
                prev = prev.plus(new BigNumber(cur.balance))
                return prev
            }, new BigNumber(0))
            console.log('calculated balance:',totalCalculatedBalance.toString(), 'totalSupply (rpc)', totalSupply)
            const reportFileName = `${reportsFolder}/token_${token.address}_block_${TargetBlockNumber}.csv`
            await writeHoldersToCsv(holdersWithBalances, reportFileName)
            console.log(`${token.name}: report ${reportFileName} created`)
        } catch (e) {
            console.log('Cannot get ', token.name, 'holders: ', e.message)
            process.exit(1)
        }
    }
}

start()
