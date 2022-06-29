const Web3 = require("web3");
const { hmyCall } = require('./utils')

const web3 = new Web3()

const ABIManager = (abi) => {
    const entries = abi
        .filter(({type}) => ['function', 'event'].includes(type))
        .map((e) => {
            let signature = ''
            if (e.type === 'function') {
                signature = web3.eth.abi.encodeFunctionSignature(e)
            } else if (e.type === 'event') {
                signature = web3.eth.abi.encodeEventSignature(e)
            }

            if (e.type === 'function' && !e.outputs) {
                throw new Error(`ABI outputs definition expected for function "${e.name}"`)
            }

            return {
                name: e.name,
                type: e.type,
                signature,
                signatureWithout0x: signature.slice(2),
                outputs: e.outputs ? e.outputs.map((e) => e.type) : [],
                inputs: e.inputs,
            }
        })

    const getEntryByName = (name) => entries.find((e) => e.name === name)

    const call = async (methodName, params, address, blockNumber) => {
        const entry = getEntryByName(methodName)

        if (!entry || entry.type !== 'function') {
            throw new Error(`${methodName} not found`)
        }

        const inputs = web3.eth.abi.encodeParameters(entry.inputs || [], params)

        const response = await hmyCall({
            to: address,
            data: entry.signature + inputs.slice(2),
        }, blockNumber)
        return web3.eth.abi.decodeParameters(entry.outputs, response)['0']
    }

    return {
        abi: entries,
        getEntryByName,
        call,
    }
}

module.exports = {
    ABIManager
}
