ALTER TABLE "products" ADD COLUMN "model_year" INTEGER;
ALTER TABLE "products" ADD COLUMN "priority_score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "youtube_featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN "youtube_video_id" VARCHAR(128);
