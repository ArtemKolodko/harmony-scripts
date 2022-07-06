require('dotenv').config()
const { Client } = require('pg')
const {arrayChunk, sleep} = require("./utils");

const settings = {
    balancesBatchSize: parseInt(process.env.BALANCES_BATCH_SIZE || '1000'),
    sleepBetweenBatches: parseInt(process.env.SLEEP_BETWEEN_BATCHES || '10000'),
}

const dbParams = {
    host: process.env.PG_HOST || 'localhost',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 's0',
    port: process.env.PG_PORT || 5432
}

const client = new Client(dbParams)

const getAddresses = async (limit = 500) => {
    const { rows } = await client.query(`
        select * from addresses
        order by address desc
        limit ${limit}
    `)
    return rows
}

const getRelatedTxs = async (property, value, offset = 0, limit = 100) => {
    const { rows } = await client.query(`
        select * from transactions
        where "${property}" = $1
        order by block_number desc
        offset ${offset}
        limit ${limit}
    `, [value])
    return rows
}

const start = async () => {
    console.log('settings: ', settings)
    console.log('Trying to establish explorer DB connection...', dbParams)
    await client.connect()

    console.log('Connected')

    const addresses = await getAddresses(10000)
    console.log('Addresses count: ', addresses.length)

    let totalTimeString = 0
    let totalTimeInteger = 0

    const getRelatedStringTime = async (address) => {
        const timeStart = Date.now()
        await getRelatedTxs('from', address)
        return Date.now() - timeStart
    }

    const getRelatedIntegerTime = async (id) => {
        const timeStart = Date.now()
        await getRelatedTxs('from_int', id)
        return Date.now() - timeStart
    }

    for(let i=0; i < addresses.length; i++) {
        const { id, address } = addresses[i]
        if (i % 2 === 0) {
            totalTimeString += await getRelatedStringTime(address)
            totalTimeInteger += await getRelatedIntegerTime(id)
        } else {
            totalTimeInteger += await getRelatedIntegerTime(id)
            totalTimeString += await getRelatedStringTime(address)
        }
        if (i > 0 && i % 500 === 0) {
            console.log('Completed ', i, 'addresses')
        }
    }

    console.log('totalTimeString', totalTimeString)
    console.log('totalTimeInteger', totalTimeInteger)

    client.end()
}

start()
