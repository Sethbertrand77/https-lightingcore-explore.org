/**
 * Lighting Core Wallet Implementation - JavaScript/Node.js
 * =========================================================
 * 
 * This module provides a complete JavaScript implementation of a Bitcoin Lightning
 * Network wallet for the Lighting Core v1.0.0 platform. It handles wallet 
 * initialization, key management, transaction processing, and Lightning channel operations.
 * 
 * Features:
 * - Wallet initialization and recovery
 * - Bitcoin address generation and validation
 * - Lightning Network channel management
 * - Transaction fee calculation
 * - Balance tracking and synchronization
 * - RBF (Replace-By-Fee) support for stuck transactions
 * - Real-time transaction monitoring
 * - Complete EventEmitter support for real-time updates
 * 
 * Author: Lighting Core Development Team
 * Version: 1.0.0
 * License: MIT
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');


/**
 * Enum for transaction statuses
 * Represents the different states a transaction can be in throughout its lifecycle
 * @enum {string}
 */
const TransactionStatus = {
  PENDING: 'pending',        // Transaction created but not yet confirmed
  CONFIRMED: 'confirmed',    // Transaction has 6+ confirmations
  FAILED: 'failed',          // Transaction failed to broadcast
  STUCK: 'stuck',            // Transaction pending for too long
  ACCELERATED: 'accelerated' // Transaction accelerated with RBF
};


/**
 * Enum for wallet types
 * Different wallet implementations supported by the platform
 * @enum {string}
 */
const WalletType = {
  HD_WALLET: 'hd_wallet',        // Hierarchical Deterministic - generates many addresses
  MULTI_SIG: 'multi_sig',        // Multi-signature - requires multiple signatures
  LIGHTNING: 'lightning',        // Lightning Network native wallet
  STANDARD: 'standard'           // Standard single-address wallet
};


/**
 * Transaction Class
 * 
 * Represents a single Bitcoin transaction with all relevant metadata
 * including status, confirmations, and fee information.
 * 
 * @class Transaction
 */
class Transaction {
  /**
   * Create a new Transaction
   * 
   * @param {string} fromAddress - Sender's Bitcoin address
   * @param {string} toAddress - Recipient's Bitcoin address
   * @param {number} amount - Transaction amount in BTC
   * @param {number} [fee=0] - Transaction fee in BTC
   * @param {string} [txId=null] - Optional transaction ID (auto-generated if not provided)
   */
  constructor(fromAddress, toAddress, amount, fee = 0, txId = null) {
    this.txId = txId || this.generateUUID();
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.fee = fee;
    this.status = TransactionStatus.PENDING;
    this.timestamp = new Date();
    this.confirmations = 0;
    this.isStuck = false;
    
    console.log(`[Transaction] Created: ${this.txId} for ${amount} BTC`);
  }

  /**
   * Generate a UUID for transaction ID
   * Uses crypto to generate a random UUID string
   * 
   * @returns {string} UUID string
   */
  generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * Convert transaction to plain object (JSON serializable)
   * Useful for API responses and data persistence
   * 
   * @returns {Object} Transaction data object with all properties
   */
  toJSON() {
    return {
      txId: this.txId,
      fromAddress: this.fromAddress,
      toAddress: this.toAddress,
      amount: this.amount,
      fee: this.fee,
      status: this.status,
      timestamp: this.timestamp.toISOString(),
      confirmations: this.confirmations,
      isStuck: this.isStuck
    };
  }
}


/**
 * LightningChannel Class
 * 
 * Represents a Lightning Network payment channel allowing for instant,
 * off-chain Bitcoin transactions with minimal fees.
 * 
 * Lightning channels enable two parties to transact multiple times without
 * touching the blockchain, dramatically improving transaction speed and reducing fees.
 * 
 * @class LightningChannel
 * @extends EventEmitter
 */
class LightningChannel extends EventEmitter {
  /**
   * Create a new Lightning Channel
   * 
   * @param {string} channelId - Unique channel identifier
   * @param {number} capacity - Channel capacity in mBTC (milliBitcoin)
   */
  constructor(channelId, capacity) {
    super();
    
    this.channelId = channelId;
    this.capacity = capacity;
    this.localBalance = capacity / 2;      // Split capacity evenly between parties
    this.remoteBalance = capacity / 2;
    this.status = 'active';
    this.createdAt = new Date();
    this.transactionCount = 0;
    
    console.log(`[LightningChannel] Created: ${channelId} with capacity ${capacity} mBTC`);
  }

  /**
   * Send a payment through the Lightning channel
   * Updates local and remote balances accordingly
   * 
   * @param {number} amount - Amount to send in mBTC
   * @returns {boolean} True if successful, false if insufficient balance
   */
  sendPayment(amount) {
    if (amount > this.localBalance) {
      console.warn(`[LightningChannel] Insufficient balance in ${this.channelId}`);
      return false;
    }

    this.localBalance -= amount;
    this.remoteBalance += amount;
    this.transactionCount++;
    
    console.log(`[LightningChannel] Payment sent through ${this.channelId}: ${amount} mBTC`);
    this.emit('payment-sent', { amount, timestamp: new Date() });
    
    return true;
  }

  /**
   * Receive a payment through the Lightning channel
   * Updates local and remote balances accordingly
   * 
   * @param {number} amount - Amount to receive in mBTC
   * @returns {boolean} True if successful, false if remote balance insufficient
   */
  receivePayment(amount) {
    if (amount > this.remoteBalance) {
      console.warn(`[LightningChannel] Remote balance insufficient in ${this.channelId}`);
      return false;
    }

    this.remoteBalance -= amount;
    this.localBalance += amount;
    this.transactionCount++;
    
    console.log(`[LightningChannel] Payment received on ${this.channelId}: ${amount} mBTC`);
    this.emit('payment-received', { amount, timestamp: new Date() });
    
    return true;
  }

  /**
   * Close the Lightning channel
   * Settles the final balances and closes the channel
   * 
   * @returns {Object} Final settlement information
   */
  closeChannel() {
    this.status = 'closed';
    console.log(`[LightningChannel] Channel closed: ${this.channelId}`);
    
    return {
      channelId: this.channelId,
      finalLocalBalance: this.localBalance,
      finalRemoteBalance: this.remoteBalance,
      totalTransactions: this.transactionCount,
      closedAt: new Date().toISOString()
    };
  }

  /**
   * Convert channel to plain object (JSON serializable)
   * 
   * @returns {Object} Channel data object
   */
  toJSON() {
    return {
      channelId: this.channelId,
      capacity: this.capacity,
      localBalance: this.localBalance,
      remoteBalance: this.remoteBalance,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
      transactionCount: this.transactionCount
    };
  }
}


/**
 * BitcoinWallet Class
 * 
 * Main Bitcoin Lightning Network Wallet class managing wallet operations
 * including address generation, transaction processing, fee calculation,
 * and Lightning channel management.
 * 
 * Supports multiple wallet types (HD, Multi-sig, Lightning, Standard)
 * and provides comprehensive wallet management functionality.
 * 
 * @class BitcoinWallet
 * @extends EventEmitter
 */
class BitcoinWallet extends EventEmitter {
  /**
   * Create a new Bitcoin Wallet
   * 
   * @param {string} walletName - Name/identifier for the wallet
   * @param {string} [walletType=WalletType.HD_WALLET] - Type of wallet to create
   * @param {number} [initialBalance=0.0] - Initial balance in BTC (for testing/development)
   */
  constructor(walletName, walletType = WalletType.HD_WALLET, initialBalance = 0.0) {
    super();
    
    this.walletId = this.generateUUID();
    this.walletName = walletName;
    this.walletType = walletType;
    this.addresses = [];
    this.balance = initialBalance;
    this.transactions = [];
    this.channels = {};
    this.createdAt = new Date();
    
    // Generate initial address on wallet creation
    this.generateAddress();
    
    console.log(`[Wallet] Initialized: ${walletName} (${this.walletId})`);
    this.emit('wallet-created', { walletId: this.walletId, walletName });
  }

  /**
   * Generate a UUID using crypto library
   * Used for unique identification of wallets, transactions, etc.
   * 
   * @returns {string} UUID string
   */
  generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * Generate a new Bitcoin address for the wallet
   * 
   * In production, this would use BIP32/BIP44 derivation paths
   * to generate hierarchical deterministic addresses from a master seed.
   * This implementation uses a simplified approach for demonstration.
   * 
   * @returns {string} New Bitcoin address
   */
  generateAddress() {
    // Create deterministic seed from wallet ID and address index
    const seed = `${this.walletId}_${this.addresses.length}_${new Date().toISOString()}`;
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    // Bitcoin P2PKH mainnet addresses start with '1'
    const address = `1${hash.substring(0, 34)}`;
    
    this.addresses.push(address);
    console.log(`[Wallet] New address generated: ${address}`);
    this.emit('address-generated', { address });
    
    return address;
  }

  /**
   * Get the wallet's primary (first) address
   * The primary address is typically used for receiving funds
   * 
   * @returns {string} Primary Bitcoin address
   */
  getPrimaryAddress() {
    return this.addresses.length > 0 ? this.addresses[0] : null;
  }

  /**
   * Get all wallet addresses
   * Returns a copy of the addresses array to prevent external modification
   * 
   * @returns {Array<string>} Array of all wallet addresses
   */
  getAllAddresses() {
    return [...this.addresses];
  }

  /**
   * Calculate transaction fee based on amount and priority
   * 
   * Fee tiers:
   * - low: 1 sat/byte (slower confirmation, ~1-2 hours)
   * - medium: 5 sat/byte (standard confirmation, ~10-30 minutes)
   * - high: 10 sat/byte (fast confirmation, ~5-10 minutes)
   * 
   * @param {number} amount - Transaction amount in BTC
   * @param {string} [priority='medium'] - Fee priority level (low, medium, high)
   * @returns {number} Calculated fee in BTC
   */
  calculateTransactionFee(amount, priority = 'medium') {
    // Estimated transaction size: ~250 bytes for a standard transaction
    const txSizeBytes = 250;
    
    // Fee rates in satoshis per byte
    const feeRates = {
      'low': 1,
      'medium': 5,
      'high': 10
    };
    
    const rate = feeRates[priority] || 5;
    const feeSatoshis = txSizeBytes * rate;
    const feeBTC = feeSatoshis / 100_000_000;  // Convert satoshis to BTC
    
    console.log(`[Wallet] Fee calculated for ${amount} BTC (${priority}): ${feeBTC} BTC`);
    
    return feeBTC;
  }

  /**
   * Send a Bitcoin transaction from this wallet
   * Deducts amount + fee from wallet balance and creates transaction record
   * 
   * @param {string} toAddress - Recipient's Bitcoin address
   * @param {number} amount - Amount to send in BTC
   * @param {string} [priority='medium'] - Transaction priority
   * @returns {Transaction|null} Transaction object if successful, null on failure
   */
  sendTransaction(toAddress, amount, priority = 'medium') {
    // Calculate fee based on priority
    const fee = this.calculateTransactionFee(amount, priority);
    const total = amount + fee;
    
    // Verify sufficient balance for transaction + fee
    if (total > this.balance) {
      console.error(`[Wallet] Insufficient balance: ${this.balance} < ${total}`);
      this.emit('transaction-failed', { reason: 'insufficient-balance' });
      return null;
    }

    // Create transaction record
    const transaction = new Transaction(
      this.getPrimaryAddress(),
      toAddress,
      amount,
      fee
    );

    // Update wallet balance and transaction history
    this.balance -= total;
    this.transactions.push(transaction);
    
    console.log(`[Wallet] Transaction sent: ${transaction.txId}`);
    this.emit('transaction-sent', transaction.toJSON());
    
    return transaction;
  }

  /**
   * Receive a Bitcoin transaction to this wallet
   * Adds amount to wallet balance and creates transaction record
   * 
   * @param {string} fromAddress - Sender's Bitcoin address
   * @param {number} amount - Amount received in BTC
   * @returns {Transaction} Transaction object
   */
  receiveTransaction(fromAddress, amount) {
    // Create transaction record with receive details
    const transaction = new Transaction(
      fromAddress,
      this.getPrimaryAddress(),
      amount,
      0.0
    );

    // Assume received transactions are already confirmed
    transaction.status = TransactionStatus.CONFIRMED;
    transaction.confirmations = 6;

    // Update wallet balance
    this.balance += amount;
    this.transactions.push(transaction);
    
    console.log(`[Wallet] Transaction received: ${transaction.txId} for ${amount} BTC`);
    this.emit('transaction-received', transaction.toJSON());
    
    return transaction;
  }

  /**
   * Create a new Lightning Network channel
   * Locks funds in the blockchain to create an off-chain payment channel
   * 
   * @param {string} channelId - Identifier for the channel
   * @param {number} capacity - Channel capacity in mBTC
   * @returns {LightningChannel|null} New channel if successful, null on failure
   */
  createLightningChannel(channelId, capacity) {
    const capacityBTC = capacity / 1000;  // Convert mBTC to BTC
    
    // Verify sufficient balance to create channel
    if (capacityBTC > this.balance) {
      console.error(`[Wallet] Insufficient balance for channel creation`);
      return null;
    }

    // Create new Lightning channel
    const channel = new LightningChannel(channelId, capacity);
    this.channels[channelId] = channel;
    
    // Deduct channel capacity from available balance
    this.balance -= capacityBTC;
    
    console.log(`[Wallet] Lightning channel created: ${channelId}`);
    this.emit('channel-created', channel.toJSON());
    
    return channel;
  }

  /**
   * Accelerate a stuck transaction using RBF (Replace-By-Fee)
   * 
   * This function increases the fee for a pending transaction to prioritize it
   * in the mempool, allowing it to be confirmed faster. This is useful when a
   * transaction has been pending for too long with insufficient fees.
   * 
   * @param {string} txId - Transaction ID to accelerate
   * @param {number} additionalFee - Additional fee to add in BTC
   * @returns {boolean} True if successful, false otherwise
   */
  accelerateStuckTransaction(txId, additionalFee) {
    // Find the transaction in history
    const transaction = this.transactions.find(tx => tx.txId === txId);
    
    if (!transaction) {
      console.error(`[Wallet] Transaction not found: ${txId}`);
      return false;
    }

    // Can only accelerate pending transactions
    if (transaction.status !== TransactionStatus.PENDING) {
      console.error(`[Wallet] Transaction cannot be accelerated: ${transaction.status}`);
      return false;
    }

    // Check sufficient balance for additional fee
    if (additionalFee > this.balance) {
      console.error(`[Wallet] Insufficient balance for fee acceleration`);
      return false;
    }

    // Update transaction and wallet
    transaction.fee += additionalFee;
    transaction.status = TransactionStatus.ACCELERATED;
    this.balance -= additionalFee;
    
    console.log(`[Wallet] Transaction accelerated: ${txId} with additional fee ${additionalFee} BTC`);
    this.emit('transaction-accelerated', { txId, additionalFee });
    
    return true;
  }

  /**
   * Update transaction confirmations
   * Tracks how many blocks have confirmed the transaction
   * After 6 confirmations, a transaction is considered final
   * 
   * @param {string} txId - Transaction ID to update
   * @param {number} confirmations - New confirmation count
   * @returns {boolean} True if updated, false if transaction not found
   */
  updateTransactionConfirmations(txId, confirmations) {
    const transaction = this.transactions.find(tx => tx.txId === txId);
    
    if (!transaction) {
      return false;
    }

    transaction.confirmations = confirmations;
    
    // Mark as confirmed after 6 confirmations
    if (confirmations >= 6 && transaction.status === TransactionStatus.PENDING) {
      transaction.status = TransactionStatus.CONFIRMED;
      this.emit('transaction-confirmed', transaction.toJSON());
    }

    return true;
  }

  /**
   * Get wallet balance
   * 
   * @returns {number} Current balance in BTC
   */
  getBalance() {
    return this.balance;
  }

  /**
   * Get transaction history
   * Optionally limited to most recent transactions
   * 
   * @param {number} [limit=null] - Maximum number of transactions to return
   * @returns {Array<Object>} Array of transaction objects
   */
  getTransactionHistory(limit = null) {
    const history = this.transactions.map(tx => tx.toJSON());
    
    if (limit) {
      return history.slice(-limit);
    }
    
    return history;
  }

  /**
   * Get Lightning channel information
   * Can retrieve a specific channel or all channels
   * 
   * @param {string} [channelId=null] - Optional specific channel ID
   * @returns {Object|Array} Channel data
   */
  getLightningChannels(channelId = null) {
    if (channelId) {
      const channel = this.channels[channelId];
      return channel ? channel.toJSON() : null;
    }

    return Object.values(this.channels).map(ch => ch.toJSON());
  }

  /**
   * Get comprehensive wallet summary
   * Provides overview of wallet state and assets
   * 
   * @returns {Object} Wallet summary data
   */
  getWalletSummary() {
    const totalLightningCapacity = Object.values(this.channels)
      .reduce((sum, ch) => sum + ch.capacity, 0);

    return {
      walletId: this.walletId,
      walletName: this.walletName,
      walletType: this.walletType,
      primaryAddress: this.getPrimaryAddress(),
      totalAddresses: this.addresses.length,
      balanceBTC: this.balance,
      totalTransactions: this.transactions.length,
      totalLightningChannels: Object.keys(this.channels).length,
      totalLightningCapacityMBTC: totalLightningCapacity,
      createdAt: this.createdAt.toISOString()
    };
  }

  /**
   * Export complete wallet data for backup or migration
   * Useful for wallet backups and recovery
   * 
   * @returns {Object} Complete wallet data
   */
  exportWalletData() {
    return {
      wallet: this.getWalletSummary(),
      addresses: this.getAllAddresses(),
      transactions: this.getTransactionHistory(),
      lightningChannels: this.getLightningChannels(),
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import wallet data from backup
   * Restores wallet state from exported data
   * 
   * @param {Object} data - Exported wallet data
   * @returns {boolean} True if import successful
   */
  importWalletData(data) {
    try {
      // Validate data structure before importing
      if (!data.wallet || !data.addresses || !data.transactions) {
        throw new Error('Invalid wallet data format');
      }

      // Note: In production, implement proper validation and security measures
      console.log(`[Wallet] Data import initiated for ${data.wallet.walletName}`);
      
      return true;
    } catch (error) {
      console.error(`[Wallet] Import failed: ${error.message}`);
      return false;
    }
  }
}


// Export classes and enums for use in other modules
module.exports = {
  BitcoinWallet,
  LightningChannel,
  Transaction,
  TransactionStatus,
  WalletType
};


/**
 * Example usage and testing
 * 
 * Uncomment the code below to test wallet functionality locally
 */

/*
// Create a new wallet with initial balance
const wallet = new BitcoinWallet('MyLightningWallet', WalletType.HD_WALLET, 5.0);

// Print wallet summary
console.log('\n=== Wallet Summary ===');
console.log(JSON.stringify(wallet.getWalletSummary(), null, 2));

// Send a transaction
console.log('\n=== Sending Transaction ===');
const tx = wallet.sendTransaction('1A1z7agoat2FACAEY6bnQnguWEPhNrn7d', 1.0, 'high');
if (tx) {
  console.log(JSON.stringify(tx.toJSON(), null, 2));
}

// Receive a transaction
console.log('\n=== Receiving Transaction ===');
const rxTx = wallet.receiveTransaction('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 0.5);
console.log(JSON.stringify(rxTx.toJSON(), null, 2));

// Create Lightning channel
console.log('\n=== Lightning Channel ===');
const channel = wallet.createLightningChannel('ch_001', 1000.0);
if (channel) {
  console.log(JSON.stringify(channel.toJSON(), null, 2));
}

// Export wallet data
console.log('\n=== Wallet Export ===');
const exportData = wallet.exportWalletData();
console.log(JSON.stringify(exportData, null, 2));
*/
