import multer, { FileFilterCallback } from 'multer';
import type { Request } from 'express';

const storage = multer.memoryStorage();

const fileFilter = (_req: Request, file: { mimetype: string }, cb: FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, WebP, and PDF files are allowed'));
  }
};

export const upload = multer({
  storage,
  fileFilter: fileFilter as multer.Options['fileFilter'],
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});
