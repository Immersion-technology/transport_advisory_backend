import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadFile = async (
  buffer: Buffer,
  folder: string,
  resourceType: 'auto' | 'image' | 'raw' = 'auto',
  originalFilename?: string
): Promise<{ url: string; publicId: string; downloadUrl: string }> => {
  return new Promise((resolve, reject) => {
    const opts: Record<string, unknown> = {
      folder: `transport_advisory/${folder}`,
      resource_type: resourceType,
      use_filename: true,
      unique_filename: true,
    };
    if (originalFilename) {
      // Preserve the extension so Cloudinary serves the correct content-type
      opts.public_id = originalFilename.replace(/\.[^.]+$/, '');
      opts.filename_override = originalFilename;
    }
    const uploadStream = cloudinary.uploader.upload_stream(opts, (error, result) => {
      if (error) return reject(error);
      if (!result) return reject(new Error('Upload failed'));

      // Inject fl_attachment so browsers download the file instead of previewing
      const toDownloadUrl = (u: string) =>
        u.replace(/\/upload\//, '/upload/fl_attachment/');

      resolve({
        url: result.secure_url,
        publicId: result.public_id,
        downloadUrl: toDownloadUrl(result.secure_url),
      });
    });
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

export const buildDownloadUrl = (cloudinaryUrl: string, filename?: string): string => {
  const base = cloudinaryUrl.replace(/\/upload\//, '/upload/fl_attachment/');
  if (filename) {
    return base.replace(/\/upload\/fl_attachment\//, `/upload/fl_attachment:${encodeURIComponent(filename)}/`);
  }
  return base;
};

export const deleteFile = async (publicId: string): Promise<void> => {
  await cloudinary.uploader.destroy(publicId);
};

export const getSignedUrl = (publicId: string, expiresIn = 3600): string => {
  return cloudinary.url(publicId, {
    sign_url: true,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    type: 'authenticated',
  });
};
