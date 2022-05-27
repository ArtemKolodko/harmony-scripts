const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const {
    readCsv,
    getAddressErc20Tokens,
    sleep,
    getERC20Balance,
    getAllErc20,
    getBridgeTokens
} = require('./utils')

const start = async () => {
    const csvLines = await readCsv('./assets/multisig-addresses.csv')
    const addresses = csvLines.map(line => line.address)
    console.log('Safes count:', addresses.length)

    const erc20Tokens = await getAllErc20()
    const bridgeTokens = await getBridgeTokens()

    // Convert array to map to easy access USD price
    const tokenUsdPrice = bridgeTokens.reduce((acc, item) => {
        const { hrc20Address, erc20Address, usdPrice, decimals } = item
        acc[hrc20Address.toLowerCase()] = usdPrice
        acc[erc20Address.toLowerCase()] = usdPrice
        return acc
    }, {})

    const erc20Map = erc20Tokens.reduce((acc, item) => {
        const { address, ...rest } = item
        acc[address.toLowerCase()] = {...rest}
        return acc
    }, {})

    const tokens = new Map()
    let totalUSDBalance = 0

    for(let i=0; i < addresses.length; i++) {
        const address = addresses[i].toLowerCase()
        const userTokens = await getAddressErc20Tokens(address)

        await Promise.all(userTokens.map(async (userToken) => {
            const { ownerAddress } = userToken
            const tokenAddress = userToken.tokenAddress.toLowerCase()

            const rpcAmount = await getERC20Balance(ownerAddress, tokenAddress)
            if(rpcAmount == 0 && userToken.balance > 0) {
                console.log('RPC ZERO!', 'tokenAddress', tokenAddress, 'ownerAddress', ownerAddress)
            }

            const existingToken = tokens.get('tokenAddress')
            const tokenSumAmount = BigInt(existingToken ? existingToken.amount : 0)

            const usdPrice = tokenUsdPrice[tokenAddress] || 0
            const decimals = erc20Map[tokenAddress].decimals || 18

            const amount = (tokenSumAmount + BigInt(rpcAmount)).toString()
            const usdAmount = usdPrice * (+BigInt(BigInt(amount) / BigInt(Math.pow(10, decimals))).toString())
            if (usdPrice > 0) {
                console.log('ownerAddress', ownerAddress, 'tokenAddress', tokenAddress, 'usdAmount', usdAmount)
                totalUSDBalance += usdAmount
            }
            tokens.set(tokenAddress, {
                amount,
                usdAmount,

            })
        }))

        if (i > 0 && i % 100 === 0) {
            console.log(`${i} / ${addresses.length} items, total USD: ${totalUSDBalance}, tokens count: ${tokens.size}`)
        }

        await sleep(20)
    }

    console.log('totalUSDBalance', totalUSDBalance)

    const sortedData = [...tokens].map((item) => {
        const [address, value] = item
        const { amount, usdAmount } = value
        const {name, symbol, decimals} = erc20Map[address]
        const amountWithDecimals = (BigInt(amount) / BigInt(Math.pow(10, decimals))).toString()
        return {
            address,
            amount: amountWithDecimals,
            decimals,
            usdAmount,
            symbol,
            name,
        }
    }).sort((a, b) => {
        const usdDiff =  b.usdAmount - a.usdAmount
        const amountDiff = b.amount - a.amount
        return usdDiff !== 0 ? usdDiff : amountDiff
    }).map((item) => {
       return {
           ...item,
           usdAmount: '$' + item.usdAmount
       }
    })

    const csvWriter = createCsvWriter({
        path: '../reports/multisig_erc20_tokens.csv',
        header: [
            {id: 'address', title: 'Address'},
            {id: 'amount', title: 'Amount'},
            {id: 'decimals', title: 'Decimals'},
            {id: 'usdAmount', title: 'USD Amount'},
            {id: 'symbol', title: 'Symbol'},
            {id: 'name', title: 'Name'},
        ]
    });

    csvWriter
        .writeRecords(sortedData)
        .then(()=> console.log('The CSV file was written successfully'));
}

start()
