import { useState } from "react";
import { uploadFileWithProgress } from "@/lib/api";
import imageCompression from "browser-image-compression";

const COMPRESSION_OPTIONS = {
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  initialQuality: 0.8,
};

export function useUpload() {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0–1

  const upload = async (ideaId: number, files: File[]) => {
    setUploading(true);
    setUploadProgress(0);
    try {
      const progresses = new Array(files.length).fill(0);

      const results = await Promise.all(
        files.map(async (file, index) => {
          let processedFile = file;

          // Compress images client-side before upload (skip HEIC/HEIF — canvas can't decode them)
          const compressible = file.type.startsWith("image/") &&
            !["image/heic", "image/heif"].includes(file.type.toLowerCase());
          if (compressible) {
            const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
            processedFile = new File([compressed], file.name, { type: compressed.type || file.type });
          }

          return uploadFileWithProgress(ideaId, processedFile, (p) => {
            progresses[index] = p;
            setUploadProgress(progresses.reduce((a, b) => a + b, 0) / progresses.length);
          });
        })
      );

      setUploadProgress(1);
      return results;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading, uploadProgress };
}
