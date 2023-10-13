import 'dotenv/config';
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { BSCResponse } from './types';

const CHANNEL_ID = '918902350150787105';
const WALLET_TO_TRACK = '0xc3057A78aC51Aec5cd69accf3bc5F4D558b8a1e1';
const VALUE_THRESHOLD = 10;

// BSC Scan API results offset
const OFFEST = 15;
// BSC Scan API call to track USDT transactions on a wallet
const bscScan = `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=0x55d398326f99059fF775485246999027B3197955&address=${WALLET_TO_TRACK}&page=1&offset=${OFFEST}&startblock=0&endblock=999999999&sort=desc&apikey=${process.env.BSC_API_KEY}`;

const callBscScan = async (): Promise<BSCResponse | null> => {
  try {
    const call = await fetch(bscScan);
    const response: BSCResponse = await call.json();
    return response;
  } catch (error) {
    console.error('callBscScan', error?.toString());
    return null;
  }
};

// Default time is 1 hour
const sleep = (time = 60 * 60 * 1000) => {
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve('');
    }, time)
  );
};

const parseValue = (value: string, decimal: string) => {
  const decimals = parseInt(decimal, 10);
  return parseFloat(ethers.formatUnits(value, decimals));
};

const checkForNewTransactions = async (channel: TextChannel): Promise<void> => {
  const response = await callBscScan();

  if (!response || response.status === '0') {
    console.log('Call to BSC Scan has failed');
    await sleep();
    return checkForNewTransactions(channel);
  }

  const previousHashFile = fs.readFileSync(
    path.resolve('previousHash.json'),
    'utf-8'
  );

  const previousHashObject: { previousHash: string } = JSON.parse(
    previousHashFile || '{}'
  );

  const previousHashIndex = response?.result.findIndex(
    (transaction) => transaction.hash === previousHashObject.previousHash
  );

  if (previousHashIndex === 0) {
    console.log('No new transactions found. Hash index is 0');
    await sleep();
    return checkForNewTransactions(channel);
  }

  const newTransactions =
    response?.result
      .slice(
        0,
        previousHashIndex > -1 ? previousHashIndex : response.result.length
      )
      .reverse()
      .filter((tx) => {
        const value = parseValue(tx.value, tx.tokenDecimal);
        return value >= VALUE_THRESHOLD;
      }) || [];

  if (!newTransactions || newTransactions?.length === 0) {
    console.log('No new transactions found. Transactions array is empty.');
    await sleep();
    return checkForNewTransactions(channel);
  }

  for (const newTransaction of newTransactions) {
    const value = parseValue(newTransaction.value, newTransaction.tokenDecimal);

    const isOutgoing =
      newTransaction.from.toLowerCase() === WALLET_TO_TRACK.toLowerCase();

    try {
      const embed = {
        title: `New Transaction (${isOutgoing ? 'Withdrawal' : 'Deposit'})`,
        url: `https://bscscan.com/tx/${newTransaction.hash}`,
        timestamp: new Date().toISOString(),
        fields: [
          {
            name: 'From',
            value: newTransaction.from,
          },
          {
            name: 'To',
            value: newTransaction.to,
          },
          {
            name: `Amount (${isOutgoing ? 'Withdrawn' : 'Deposited'})`,
            value: value?.toLocaleString('en-US', {
              style: 'currency',
              currency: 'USD',
            }),
          },
        ],
      };

      channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('for_loop_newTransactions', error?.toString());
      continue;
    }
    await sleep(5 * 1000);
  }

  const newPreviousHash = {
    previousHash:
      newTransactions.at(-1)?.hash || previousHashObject.previousHash,
  };

  fs.writeFileSync(
    path.resolve('previousHash.json'),
    JSON.stringify(newPreviousHash)
  );

  await sleep();

  return checkForNewTransactions(channel);
};

const main = async () => {
  const client = new Client({
    intents: [
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('ready', async () => {
    console.log('TAI Discord bot is online');
    const channel = (await client.channels.fetch(CHANNEL_ID)) as TextChannel;
    checkForNewTransactions(channel);
  });

  client.login(process.env.DISCORD_TOKEN);
};

main();
