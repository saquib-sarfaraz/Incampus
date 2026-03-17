export const compressImageFile = (file, options = {}) => {
  const {
    maxWidth = 1080,
    maxHeight = 1350,
    quality = 0.78,
    minSize = 500 * 1024,
  } = options;

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
        const scale = Math.min(
          1,
          maxWidth / Math.max(image.width, 1),
          maxHeight / Math.max(image.height, 1)
        );
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
  /\/upload\/[^/]*(?:f_|q_|w_|h_|c_|vc_)/.test(url);

const stripCloudinaryFormatExtension = (url = "") => {
  if (!url || typeof url !== "string") return url;
  if (!isCloudinaryUrl(url)) return url;
  // When we use `f_auto`, keeping an explicit format extension (e.g. `.webp`) can
  // force an incompatible format on older iOS/Safari. Stripping the extension
  // lets Cloudinary negotiate the best format based on the request.
  const [base, suffix = ""] = url.split(/([?#].*)/);
  const stripped = base.replace(/\.(avif|webp|jpe?g|png|gif|bmp)$/i, "");
  return `${stripped}${suffix}`;
};

const buildCloudinaryTransform = ({ width = 600, height, quality = "auto", format = "auto" } = {}) => {
  const parts = [];
  if (format) parts.push(`f_${format}`);
  if (quality) parts.push(`q_${quality}`);
  if (width) parts.push(`w_${width}`);
  if (height) parts.push(`h_${height}`);
  parts.push("c_limit");
  return parts.join(",");
};

const buildCloudinaryVideoTransform = () => "q_auto:good,vc_auto";

export const getOptimizedMediaUrl = (url, options = {}) => {
  if (!url || !isCloudinaryUrl(url)) return url;
  // If a Cloudinary URL already includes f_auto, make sure we don't force an
  // extension like `.webp` that can break on some devices.
  if (hasCloudinaryTransform(url) && /\/upload\/[^/]*\bf_auto\b/.test(url)) {
    return stripCloudinaryFormatExtension(url);
  }
  if (hasCloudinaryTransform(url)) return url;
  const transform = buildCloudinaryTransform(options);
  if (!transform) return url;
  const next = url.replace(
    CLOUDINARY_UPLOAD_SEGMENT,
    `${CLOUDINARY_UPLOAD_SEGMENT}${transform}/`
  );
  return stripCloudinaryFormatExtension(next);
};

export const getOptimizedVideoUrl = (url) => {
  if (!url || !isCloudinaryUrl(url) || hasCloudinaryTransform(url)) return url;
  const transform = buildCloudinaryVideoTransform();
  if (!transform) return url;
  return url.replace(CLOUDINARY_UPLOAD_SEGMENT, `${CLOUDINARY_UPLOAD_SEGMENT}${transform}/`);
};

export const getMediaSrcSet = (url, widths = [240, 360, 480, 600]) => {
  if (!url || !isCloudinaryUrl(url) || hasCloudinaryTransform(url)) return null;
  return widths
    .map((width) => `${getOptimizedMediaUrl(url, { width })} ${width}w`)
    .join(", ");
};

const ASPECT_RATIO_MAP = {
  "1:1": 1,
  "4:5": 4 / 5,
  "1.91:1": 1.91,
};

export const resolveAspectRatioValue = (ratio) => {
  if (!ratio) return null;
  if (typeof ratio === "number" && Number.isFinite(ratio)) return ratio;
  const normalized = String(ratio).trim();
  if (ASPECT_RATIO_MAP[normalized]) return ASPECT_RATIO_MAP[normalized];
  if (normalized.includes(":")) {
    const [w, h] = normalized.split(":").map((value) => Number(value));
    if (Number.isFinite(w) && Number.isFinite(h) && h !== 0) {
      return w / h;
    }
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

export const resolveAspectRatioString = (ratio) => {
  const value = resolveAspectRatioValue(ratio);
  if (!value) return "4 / 5";
  if (String(ratio).trim() === "1.91:1") return "1.91 / 1";
  if (String(ratio).trim() === "4:5") return "4 / 5";
  if (String(ratio).trim() === "1:1") return "1 / 1";
  if (value >= 1) return `${value} / 1`;
  return `1 / ${Number((1 / value).toFixed(3))}`;
};

export const detectAspectRatio = (width, height) => {
  if (!width || !height) return "4:5";
  if (width === height) return "1:1";
  if (width > height * 1.2) return "1.91:1";
  return "4:5";
};

export const createCroppedImage = (file, aspectRatio, options = {}) => {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    return Promise.resolve(file);
  }
  const ratioValue = resolveAspectRatioValue(aspectRatio);
  if (!ratioValue) return Promise.resolve(file);
  const { quality = 0.8 } = options;

  return new Promise((resolve) => {
    const reader = new FileReader();
    const image = new Image();

    reader.onload = () => {
      image.onload = () => {
        const imgRatio = image.width / image.height;
        let cropWidth = image.width;
        let cropHeight = image.height;

        if (Math.abs(imgRatio - ratioValue) <= 0.02) {
          resolve(file);
          return;
        }

        if (imgRatio > ratioValue) {
          cropWidth = Math.round(image.height * ratioValue);
        } else if (imgRatio < ratioValue) {
          cropHeight = Math.round(image.width / ratioValue);
        }

        const sx = Math.max(0, Math.round((image.width - cropWidth) / 2));
        const sy = Math.max(0, Math.round((image.height - cropHeight) / 2));

        const canvas = document.createElement("canvas");
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const croppedFile = new File(
              [blob],
              file.name.replace(/\.[^/.]+$/, ".jpg"),
              { type: "image/jpeg" }
            );
            resolve(croppedFile);
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

export const getOptimizedFillUrl = (url, options = {}) => {
  const { width = 900, aspectRatio } = options;
  const ratioValue = resolveAspectRatioValue(aspectRatio);
  if (!url || !isCloudinaryUrl(url) || hasCloudinaryTransform(url)) return url;
  const height = ratioValue ? Math.round(width / ratioValue) : null;
  const parts = ["f_auto", "q_auto", `w_${width}`];
  if (height) parts.push(`h_${height}`);
  parts.push("c_fill");
  const transform = parts.join(",");
  const next = url.replace(
    CLOUDINARY_UPLOAD_SEGMENT,
    `${CLOUDINARY_UPLOAD_SEGMENT}${transform}/`
  );
  return stripCloudinaryFormatExtension(next);
};
