const express = require('express');
const request = require('request');
const bodyParser = require('body-parser');
const Blockchain = require('../blockhain');
const TransactionPool = require('../wallet/transaction-pool');
const Wallet = require('../wallet');
const PubSub = require('./pubsub');
const TransactionMiner = require('./transaction-miner');

const DEFAULT_PORT = 3000;
let PEER_PORT;
if (process.env.GENERATE_PEER_PORT === 'true') {
    PEER_PORT = DEFAULT_PORT + Math.ceil(Math.random() * 1000);
}
const PORT = PEER_PORT || DEFAULT_PORT;
const ROOT_NODE_ADDRESS = `http://localhost:${DEFAULT_PORT}`;

const app = express();
const bc = new Blockchain();
const transactionPool = new TransactionPool();
const wallet = new Wallet();
const pubsub = new PubSub({blockchain: bc, transactionPool});
const transactionMiner = new TransactionMiner({ blockchain: bc, transactionPool, wallet, pubsub });

setTimeout(() => pubsub.broadcastChain(), 1000);

app.use(bodyParser.json());

app.get('/api/blocks', (req, res) => {
    res.json(bc.chain);
});

app.post('/api/mine', (req, res) => {
    const block = bc.addBlock({data: req.body.data});
    pubsub.broadcastChain();
    res.redirect('/api/blocks');
});

app.post('/api/transact', (req, res) => {
    const {amount, recipient} = req.body;

    let transaction = transactionPool.existingTransaction({ inputAddress: wallet.publicKey });

    try {
        if (transaction) {
            transaction.update({ senderWallet: wallet, recipient, amount });
        } else {
            transaction = wallet.createTransaction({ 
                recipient, 
                amount, 
                chain: bc.chain 
            });
        }
        
    } catch (error) {
        return res.status(400).json({ type: 'error', message: error.message });
    }

    transactionPool.setTransaction(transaction);

    pubsub.broadcastTransaction(transaction);

    res.json({ type: 'success', transaction });
});

app.get('/api/transaction-pool-map', (req, res) => {
    res.json(transactionPool.transactionMap);
});

app.get('/api/mine-transactions', (req, res) => {
    transactionMiner.mineTransactions();

    res.redirect('/api/blocks');
});

app.get('/api/wallet-info', (req, res) => {
    const address = wallet.publicKey;
    res.json({ address, balance: Wallet.calculateBalance({ chain: bc.chain, address}) })
});


const syncWithRootState = () => {
    request({url: `${ROOT_NODE_ADDRESS}/api/blocks`} , (error, response, body) => {
        if (!error && response.statusCode == 200) {
            const rootChain = JSON.parse(body);

            console.log('replace chain on a sync with', rootChain);
            bc.replaceChain(rootChain);
        }
    });

    request({ url: `${ROOT_NODE_ADDRESS}/api/transaction-pool-map` }, (error, response, body) => {
        if(!error && response.statusCode === 200) {
            const rootTransactionPoolMap = JSON.parse(body);

            console.log('replace transaction pool map on a sync with', rootTransactionPoolMap);
            transactionPool.setMap(rootTransactionPoolMap);
        }
    })
};

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
    if (PORT !== DEFAULT_PORT) {
        syncWithRootState();
    }
});