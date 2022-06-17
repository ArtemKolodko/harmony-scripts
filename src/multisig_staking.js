/*
Methods:
0x510b11bb - Delegate
0xbda8c0e9 - Undelegate
0x6d6b2f77 - CollectRewards

To get amounts from multisig db:

SELECT arguments, RIGHT(arguments->>'data', 30) as delegated_amount_hex
FROM public.history_internaltxdecoded
where arguments->>'to' = '0x00000000000000000000000000000000000000fc'
and substring(arguments->>'data', 0, 11)  = '0x510b11bb'
order by internal_tx_id desc

"<amount1 amount2...>"
.split(' ')
.map(hex => (BigInt('0x' + hex) / BigInt(Math.pow(10, 18))))
.reduce((acc, item) =>  acc + item, BigInt(0))
* */

const axios = require("axios");
const { Client } = require('pg')
const BigNumber = require('bignumber.js')
require('dotenv').config()

const StakingPrecompileAddress = '0x00000000000000000000000000000000000000fc'
const StakingApiUrl = 'https://api.stake.hmny.io'

const dbParams = {
    host: process.env.MULTISIG_DB_HOST || '',
    user: process.env.MULTISIG_DB_USERNAME || '',
    password: process.env.MULTISIG_DB_PASSWORD || '',
    database: process.env.MULTISIG_DB_NAME || '',
    port: 5432
}

const getSafeStakingAddresses = async () => {
    console.log('Trying to establish multisig DB connection...', dbParams)
    const client = new Client(dbParams)
    await client.connect()
    console.log('Start getting addresses from multisig db')
    const { rows } = await client.query(`
        SELECT distinct(safe) as address
        FROM public.history_multisigtransaction
        where "to" = '${StakingPrecompileAddress}'
    `)
    client.end()
    return rows.map((row) => row.address)
}

const getAddressStakingInfo = async (safeAddress) => {
    const { data: stakingItems } = await axios.get(`${StakingApiUrl}/networks/mainnet/delegations/${safeAddress}`)
    let delegated = new BigNumber(0)
    let undelegated = new BigNumber(0)
    let reward = new BigNumber(0)
    stakingItems.forEach((item) => {
        const { amount = 0, reward: _reward = 0, Undelegations } = item
        delegated = delegated.plus(new BigNumber(amount))
        undelegated = Undelegations.reduce((acc, nextValue) => {
            acc = acc.plus(new BigNumber(nextValue.Amount))
            return acc
        }, new BigNumber(0))
        reward = reward.plus(new BigNumber(_reward))
    })
    return {
        delegated,
        undelegated,
        reward,
    }
}

const getAddressesStats = async (addresses) => {
    let delegated = new BigNumber(0)
    let undelegated = new BigNumber(0)
    let reward = new BigNumber(0)

    for(let i=0; i < addresses.length; i++) {
        const address = addresses[i]
        const addressData = await getAddressStakingInfo(address)
        delegated = delegated.plus(addressData.delegated)
        undelegated = undelegated.plus(addressData.undelegated)
        reward = reward.plus(addressData.reward)
    }

    return {
        delegated: delegated.div(BigNumber(Math.pow(10, 18))),
        undelegated: undelegated.div(BigNumber(Math.pow(10, 18))),
        reward: reward.div(BigNumber(Math.pow(10, 18))),
    }
}

const start = async () => {
    const safeAddresses = await getSafeStakingAddresses()
    console.log(`Received ${safeAddresses.length} addresses, start retrieving balances...`)
    const  { delegated, undelegated, reward } = await getAddressesStats(safeAddresses)
    console.log('Safes count:', safeAddresses.length)
    console.log(`Total delegated: ${delegated}, undelegated: ${undelegated}, reward: ${reward}`)
}

start()
