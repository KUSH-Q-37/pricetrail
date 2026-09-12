import { Queue } from 'bullmq';
import { createRedisConnection, QUEUE } from '@pricetrail/queue';

async function main() {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ ERROR: REDIS_URL is not set. Please set it in your terminal or .env file.');
    process.exit(1);
  }

  console.log(`Connecting to Redis: ${redisUrl.split('@').pop()}...`);
  const connection = createRedisConnection(redisUrl);

  console.log('Clearing old ghost jobs from all queues...\n');

  for (const queueName of Object.values(QUEUE)) {
    console.log(`Draining queue: ${queueName}`);
    const q = new Queue(queueName, { connection });
    
    // Drain removes all waiting and delayed jobs
    await q.drain(true);
    
    // Obliterate completely destroys the queue and all its data (active, failed, etc)
    try {
      await q.obliterate({ force: true });
      console.log(`✅ Successfully wiped ${queueName}`);
    } catch (err: any) {
      console.log(`⚠️  Could not completely obliterate ${queueName} (it might be empty or active). Drain was successful though.`);
    }
    
    await q.close();
  }

  connection.disconnect();
  console.log('\n🎉 Done! All queues are empty. Your Render logs should be quiet now.');
}

main().catch(console.error);
