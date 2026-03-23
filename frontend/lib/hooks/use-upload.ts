import { useState } from "react";
import { uploadFile } from "@/lib/api";
import imageCompression from "browser-image-compression";

const COMPRESSION_OPTIONS = {
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  initialQuality: 0.8,
};

export function useUpload() {
  const [uploading, setUploading] = useState(false);

  const upload = async (ideaId: number, files: File[]) => {
    setUploading(true);
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          let processedFile = file;

          // Compress images client-side before upload
          if (file.type.startsWith("image/")) {
            processedFile = await imageCompression(file, COMPRESSION_OPTIONS);
          }

          return uploadFile(ideaId, processedFile);
        })
      );
      return results;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
}
