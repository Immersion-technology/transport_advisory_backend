import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './routes/auth';
import vehicleRoutes from './routes/vehicles';
import applicationRoutes from './routes/applications';
import verificationRoutes from './routes/verifications';
import adminRoutes from './routes/admin';
import reminderRoutes from './routes/reminders';
import { startReminderJob } from './jobs/reminderJob';
import { globalLimiter } from './middleware/rateLimit';

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy so rate limiting sees the real client IP behind Render/Vercel/Nginx
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Apply the global limiter to everything under /api
app.use('/api', globalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/verifications', verificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reminders', reminderRoutes);

app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

app.listen(PORT, () => {
  console.log(`\n🚀 AutoDoc API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  startReminderJob();
});

export default app;
