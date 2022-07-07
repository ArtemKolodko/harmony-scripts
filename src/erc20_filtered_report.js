const { getBridgeTokens, readCsv, upsertFile} = require('./utils')
const {createObjectCsvWriter: createCsvWriter} = require("csv-writer");
const moment = require("moment");
const fs = require("fs");
const BigNumber = require("bignumber.js");

BigNumber.config({ DECIMAL_PLACES: 30, EXPONENTIAL_AT: 30 })

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

const BLOCK_FROM = 28115058
const BLOCK_TO = 28432800
const BALANCE_RANGE_FROM = 0
const BALANCE_RANGE_TO = 1000000000

const getErc20MapWithPrice = async () => {
    const erc20Map = {}
    const bridgeTokens = await getBridgeTokens()
    ERC20TokensList.forEach((token) => {
        const bridgeTokensFiltered = bridgeTokens.filter((b) =>
            b.hrc20Address.toLowerCase() === token.address.toLowerCase() && b.usdPrice > 0)
        let usdPrice = bridgeTokensFiltered[0] ? bridgeTokensFiltered[0].usdPrice : 0
        // bscBUSD = $1
        if (token.address.toLowerCase() === '0x0aB43550A6915F9f67d0c454C2E90385E6497EaA'.toLowerCase()) {
            usdPrice = 1
        }
        // https://coinmarketcap.com/currencies/aag-ventures/
        if (token.address.toLowerCase() === '0xAE0609A062a4eAED49dE28C5f6A193261E0150eA'.toLowerCase()) {
            usdPrice = 0.006797
        }
        // 1DAI
        if (token.address.toLowerCase() === '0xEf977d2f931C1978Db5F6747666fa1eACB0d0339'.toLowerCase()) {
            usdPrice = 1
        }
        console.log(`${token.name} price = $${+usdPrice}`)
        if (+usdPrice === 0) {
            console.log('EXIT: token price = 0')
            process.exit(1)
        }
        erc20Map[token.address] = {
            ...token,
            usdPrice: +usdPrice
        }
    })
    return erc20Map
}

// Report format:
// Address,Balance
// 0xfffc9841deadbdc3b2a34bc612e87ce2a65ba945,0.000032812139635663
const getUserFromReport = async (blockNumber, token) => {
    const csvLinesPrev = await readCsv(`./reports/report_erc20_${blockNumber}/token_${token.address}_block_${blockNumber}.csv`)
    // const addresses = csvLinesPrev.map(line => line.Address)
    return csvLinesPrev
}

const getMatchedUsers = (arr1, arr2, tokenUsdPrice) => {
    return arr1
        .map(user1 => {
            const user2 = arr2.find((user2) => user2.Address === user1.Address)
            const balance1 = user1.Balance
            const balance2 = user2 ? user2.Balance : 0
            const balanceUSD1 = new BigNumber(balance1).multipliedBy(tokenUsdPrice)
            const balanceUSD2 = new BigNumber(balance2).multipliedBy(tokenUsdPrice)
            return {
                Address: user1.Address,
                [`Balance_${BLOCK_FROM}`]: balance1,
                [`Balance_USD_${BLOCK_FROM}`]: balanceUSD1.toString(10),
                [`Balance_${BLOCK_TO}`]: balance2,
                [`Balance_USD_${BLOCK_TO}`]: balanceUSD2.toString(10),
            }
        })
        .filter((user) => user[`Balance_${BLOCK_FROM}`] > 0 && user[`Balance_${BLOCK_TO}`] > 0)
        .sort((a, b) => b[`Balance_${BLOCK_FROM}`] - a[`Balance_${BLOCK_FROM}`])
}

const writeHoldersToCsv = async (holders, filename) => {
    const csvWriter = createCsvWriter({
        path: filename,
        header: [
            {id: 'Address', title: 'Address'},
            {id: [`Balance_${BLOCK_FROM}`], title: [`Balance_${BLOCK_FROM}`]},
            {id: [`Balance_USD_${BLOCK_FROM}`], title: [`Balance_USD_${BLOCK_FROM}`]},
            {id: [`Balance_${BLOCK_TO}`], title: [`Balance_${BLOCK_TO}`]},
            {id: [`Balance_USD_${BLOCK_TO}`], title: [`Balance_USD_${BLOCK_TO}`]},
        ]
    });
    await upsertFile(filename)
    await csvWriter.writeRecords(holders)
}

const start = async () => {
    const reportsFolder = `./reports/holders_erc20_$${BALANCE_RANGE_FROM}_$${BALANCE_RANGE_TO}_${moment().format()}`
    fs.mkdirSync(reportsFolder, { recursive: true });

    const erc20Map = await getErc20MapWithPrice()

    for(let i=0; i < ERC20TokensList.length; i++) {
        const token = ERC20TokensList[i]

        const usersPrev = await getUserFromReport(BLOCK_FROM, token)
        const usersCurrent = await getUserFromReport(BLOCK_TO, token)
        const stayedUsers = getMatchedUsers(usersPrev, usersCurrent, erc20Map[token.address].usdPrice)

        const stayedWithBalances = stayedUsers
        .filter(user => {
            const usdBlockFrom = user[`Balance_USD_${BLOCK_FROM}`]
            const usdBlockTo = user[`Balance_USD_${BLOCK_TO}`]
            const isUserBalanceDecreased = usdBlockFrom > usdBlockTo
            const usdBalanceInRange = usdBlockFrom >= BALANCE_RANGE_FROM && usdBlockFrom < BALANCE_RANGE_TO &&
                usdBlockTo >= BALANCE_RANGE_FROM && usdBlockTo < BALANCE_RANGE_TO
            return usdBalanceInRange
        })

        console.log(`${token.name}: stayed addresses ${stayedUsers.length}, stayed with balances $${BALANCE_RANGE_FROM} - $${BALANCE_RANGE_TO}: ${stayedWithBalances.length}`)

        const reportFileName = `${reportsFolder}/token_${token.name}_${token.address}_holders_${BLOCK_FROM}_${BLOCK_TO}.csv`
        await writeHoldersToCsv(stayedWithBalances, reportFileName)
        console.log(`${token.name}: report ${reportFileName} created`)
    }
}

start()
