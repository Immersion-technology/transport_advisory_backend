import axios from 'axios';

const TERMII_BASE_URL = 'https://api.ng.termii.com/api';

export const sendSMS = async (to: string, message: string): Promise<void> => {
  try {
    await axios.post(`${TERMII_BASE_URL}/sms/send`, {
      to,
      from: process.env.TERMII_SENDER_ID || 'TransAdv',
      sms: message,
      type: 'plain',
      channel: 'dnd',
      api_key: process.env.TERMII_API_KEY,
    });
  } catch (error) {
    console.error('SMS send failed:', error);
    throw error;
  }
};

export const buildReminderSMS = (params: {
  firstName: string;
  plateNumber: string;
  documentType: string;
  expiryDate: string;
  daysLeft: number;
}): string => {
  const { firstName, plateNumber, documentType, expiryDate, daysLeft } = params;

  if (daysLeft === 0) {
    return `URGENT: ${firstName}, your ${documentType} for ${plateNumber} expired today (${expiryDate}). Renew NOW to avoid fines & impoundment. Visit transportadvisory.ng`;
  }
  if (daysLeft === 1) {
    return `ALERT: ${firstName}, your ${documentType} for ${plateNumber} expires TOMORROW (${expiryDate}). Renew now at transportadvisory.ng`;
  }
  return `Reminder: ${firstName}, your ${documentType} for ${plateNumber} expires in ${daysLeft} days (${expiryDate}). Renew easily at transportadvisory.ng`;
};
