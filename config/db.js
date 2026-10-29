require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  // The free Clever Cloud plan allows only 5 connections, so keep this low
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 3,
  queueLimit: 0,
  enableKeepAlive: true,
  dateStrings: true,      // DATE columns come back as 'YYYY-MM-DD'
  decimalNumbers: true,   // DECIMAL columns come back as numbers
});

module.exports = pool;