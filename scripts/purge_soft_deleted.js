'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const Message = require('../src/models/Message');

async function main() {
  try {
    console.log('Connecting to database...');
    await connectDatabase();
    
    console.log('Finding and deleting all soft-deleted messages (isHidden: true)...');
    const result = await Message.deleteMany({ isHidden: true });
    
    console.log(`Successfully deleted ${result.deletedCount} soft-deleted messages!`);
  } catch (err) {
    console.error('Error running purge script:', err);
  } finally {
    await disconnectDatabase();
    process.exit(0);
  }
}

main();
