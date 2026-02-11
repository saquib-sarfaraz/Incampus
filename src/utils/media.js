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
