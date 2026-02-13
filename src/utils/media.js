export const compressImageFile = (file, options = {}) => {
  const { maxDimension = 1600, quality = 0.85, minSize = 500 * 1024 } = options;

  if (!file || !file.type || !file.type.startsWith("image/")) {
    return Promise.resolve(file);
  }

  if (file.size <= minSize) {
    return Promise.resolve(file);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    const image = new Image();

    reader.onload = () => {
      image.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const targetWidth = Math.round(image.width * scale);
        const targetHeight = Math.round(image.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const compressedFile = new File(
              [blob],
              file.name.replace(/\.[^/.]+$/, ".jpg"),
              { type: "image/jpeg" }
            );
            resolve(compressedFile);
          },
          "image/jpeg",
          quality
        );
      };
      image.onerror = () => resolve(file);
      image.src = reader.result;
    };

    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
};

const CLOUDINARY_HOST = "res.cloudinary.com";
const CLOUDINARY_UPLOAD_SEGMENT = "/upload/";

const isCloudinaryUrl = (url = "") =>
  typeof url === "string" &&
  url.includes(CLOUDINARY_HOST) &&
  url.includes(CLOUDINARY_UPLOAD_SEGMENT);

const hasCloudinaryTransform = (url = "") =>
  /\/upload\/[^/]*(?:f_|q_|w_|h_|c_)/.test(url);

const buildCloudinaryTransform = ({ width, height, quality = "auto", format = "auto" } = {}) => {
  const parts = [];
  if (format) parts.push(`f_${format}`);
  if (quality) parts.push(`q_${quality}`);
  if (width) parts.push(`w_${width}`);
  if (height) parts.push(`h_${height}`);
  parts.push("c_limit");
  return parts.join(",");
};

export const getOptimizedMediaUrl = (url, options = {}) => {
  if (!url || !isCloudinaryUrl(url) || hasCloudinaryTransform(url)) return url;
  const transform = buildCloudinaryTransform(options);
  if (!transform) return url;
  return url.replace(CLOUDINARY_UPLOAD_SEGMENT, `${CLOUDINARY_UPLOAD_SEGMENT}${transform}/`);
};

export const getMediaSrcSet = (url, widths = [320, 480, 640, 768, 1024]) => {
  if (!url || !isCloudinaryUrl(url) || hasCloudinaryTransform(url)) return null;
  return widths
    .map((width) => `${getOptimizedMediaUrl(url, { width })} ${width}w`)
    .join(", ");
};
