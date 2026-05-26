const { PrismaClient } = require('@prisma/client');

// Single shared Prisma client across the app (and reused by bot.js).
const prisma = global.__reeloguePrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__reeloguePrisma = prisma;

module.exports = prisma;
