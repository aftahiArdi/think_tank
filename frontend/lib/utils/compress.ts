import imageCompression from "browser-image-compression";

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  return imageCompression(file, {
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    initialQuality: 0.8,
  });
}
