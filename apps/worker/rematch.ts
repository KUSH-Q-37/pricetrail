import { PrismaClient } from '@prisma/client';
import { QueueProducer, createRedisConnection, QUEUE } from '@pricetrail/queue';

const prisma = new PrismaClient();

async function main() {
  console.log('Fetching listings that need review...');
  
  // Find all matches that are currently stuck in NEEDS_REVIEW
  const stuckMatches = await prisma.productMatch.findMany({
    where: { status: 'NEEDS_REVIEW' },
    select: { listingAId: true, listingBId: true }
  });

  if (stuckMatches.length === 0) {
    console.log('No matches stuck in NEEDS_REVIEW. You are good to go!');
    return;
  }

  // Get a unique set of listing IDs to prevent double queueing
  const listingIds = new Set<string>();
  for (const match of stuckMatches) {
    listingIds.add(match.listingAId);
  }

  console.log(`Found ${listingIds.size} listings to re-evaluate. Connecting to Redis...`);
  
  // Connect to Redis for BullMQ
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = createRedisConnection(redisUrl);
  const producer = new QueueProducer(connection);

  console.log('Enqueuing jobs to BullMQ...');
  let count = 0;
  for (const listingId of listingIds) {
    await producer.enqueueOrPromote(QUEUE.match, { listingId }, { priority: 1 });
    count++;
    if (count % 100 === 0) console.log(`Enqueued ${count} jobs...`);
  }

  console.log(`\nSuccessfully enqueued ${count} matches for re-evaluation!`);
  console.log('The background worker will now re-score them and automatically merge them.');
  
  await producer.close();
  connection.disconnect();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
