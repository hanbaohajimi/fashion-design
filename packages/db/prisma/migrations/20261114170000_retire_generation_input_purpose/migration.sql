-- Historical values remain readable. New references carry identity without a
-- permanent purpose or an automatically supplied influence weight.
ALTER TABLE "generation_inputs" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "generation_inputs" ALTER COLUMN "weight" DROP NOT NULL;
ALTER TABLE "generation_inputs" ALTER COLUMN "weight" DROP DEFAULT;
