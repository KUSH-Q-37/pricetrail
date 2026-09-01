const { PrismaClient } = require('./packages/database/generated/client');
process.env.DATABASE_URL = 'postgresql://pricetrail:pricetrail_dev_password@localhost:5432/pricetrail?schema=public';
const prisma = new PrismaClient();
prisma.product.findFirst({ where: { displayTitle: { contains: 'IFB' } }, select: { id: true } })
.then(console.log)
.finally(() => prisma.$disconnect());
