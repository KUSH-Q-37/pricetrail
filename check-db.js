const { PrismaClient } = require('./packages/database/generated/client');
process.env.DATABASE_URL = 'postgresql://pricetrail:pricetrail_dev_password@localhost:5432/pricetrail?schema=public';
const prisma = new PrismaClient();
prisma.pricePoint.findMany({
  orderBy: { capturedAt: 'desc' },
  take: 10
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
