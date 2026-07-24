'use strict';
require('dotenv').config();
try {
  const config = require('../src/config/env');
  console.log('✅ Config loaded successfully');
  console.log('   NODE_ENV :', config.env);
  console.log('   Bot name :', config.bot.name);
  console.log('   MongoDB  :', config.mongodb.uri ? 'SET' : 'MISSING');
  console.log('   Telegram :', config.telegram.token.startsWith('FILL') ? '⚠ placeholder' : 'SET');
  console.log('   OpenAI   :', config.openai.apiKey.startsWith('FILL') ? '⚠ placeholder' : 'SET');
  console.log('   Replicate:', config.replicate.apiToken.startsWith('FILL') ? '⚠ placeholder' : 'SET');
  console.log('   Secrets  :', config.admin.secretKey.length >= 32 ? 'OK' : 'MISSING');
} catch (e) {
  console.error('❌ Config validation failed:');
  console.error(e.message);
}
