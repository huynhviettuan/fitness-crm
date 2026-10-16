-- M4.1b (T-052, D-042, A-143, A-144): private file storage. The row describes the file; the bytes live in the storage
-- (disk in development, Cloudflare R2 in staging and production).
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "files_size_check" CHECK ("size" > 0)
);
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "services" ADD COLUMN "image_file_id" UUID;
ALTER TABLE "services" ADD CONSTRAINT "services_image_file_id_fkey" FOREIGN KEY ("image_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD COLUMN "proof_file_id" UUID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_file_id_fkey" FOREIGN KEY ("proof_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
